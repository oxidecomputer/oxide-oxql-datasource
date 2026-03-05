import { getBackendSrv, getTemplateSrv, isFetchError } from '@grafana/runtime';
import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
  MetricFindValue,
  DataFrame,
} from '@grafana/data';

import type { OxqlQueryResult, OxqlTable, Silo, Project, TimeseriesQuery } from '@oxide/api';
import { OxqlQuery, OxqlOptions, DEFAULT_QUERY, processResponseBody, snakeToCamel } from './types';
import { lastValueFrom } from 'rxjs';

const QUERY_URL = '/v1/system/timeseries/query';
const SILO_URL = '/v1/system/silos';
const PROJECT_URL = '/v1/projects';

export class DataSource extends DataSourceApi<OxqlQuery, OxqlOptions> {
  baseUrl: string;
  projects: Record<string, string> = {};
  silos: Record<string, string> = {};

  constructor(instanceSettings: DataSourceInstanceSettings<OxqlOptions>) {
    super(instanceSettings);
    this.baseUrl = instanceSettings.url!;
  }

  getDefaultQuery(_: CoreApp): Partial<OxqlQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: OxqlQuery): boolean {
    return !!query.queryText;
  }

  /**
   * metricFindQuery is used by Grafana to identify the set of potential values
   * for a template variable, based on the user's query. This implementation
   * allows users to define variable values based on an OxQL query using the
   * `label_values(metric_name, id, [label])` function. We query OxQL for the
   * given metric name, then use the labels defined by `id` and `label` as the
   * values and labels for the template variable.
   */
  async metricFindQuery(query: string): Promise<MetricFindValue[]> {
    const labels: Record<string, string> = {};

    // Match `label_values(metric, id_label)` or `label_values(metric,
    // id_label, label_label)`.
    //
    // TODO: implement a custom UI with `CustomVariableSupport` and drop this
    // DSL.
    const pattern = /label_values\((?<metric>[\w:]+),\s*(?<value>\w+)(,\s(?<label>\w+))?\)/;
    const match = query.match(pattern);

    if (match && match.groups) {
      const groups = match.groups;
      groups.label = groups.label || groups.value;
      // Convert user-provided field names from snake_case to camelCase to
      // match the converted API response keys.
      const valueField = snakeToCamel(groups.value);
      const labelField = snakeToCamel(groups.label);
      const body: TimeseriesQuery = { query: `get ${groups.metric} | filter timestamp > @now() - 5m | last 1` };
      const response = await this.request<OxqlQueryResult>(QUERY_URL, 'POST', '', body);

      // Fetch additional metadata from Oxide API if requested.
      let silos: Record<string, string> = {};
      if (labelField === 'siloName' || valueField === 'siloName') {
        silos = await this.getSilos();
      }
      let projects: Record<string, string> = {};
      if (labelField === 'projectName' || valueField === 'projectName') {
        projects = await this.getProjects();
      }

      response.data.tables.forEach((table) => {
        table.timeseries.forEach((series) => {
          const fields = series.fields as Record<string, { value: string | number | boolean }>;
          // Enrich series with additional metadata if requested.
          if (labelField === 'siloName' || valueField === 'siloName') {
            if ('siloId' in fields && silos[fields['siloId'].value as string]) {
              fields['siloName'] = { value: silos[fields['siloId'].value as string] };
            }
          }
          if (labelField === 'projectName' || valueField === 'projectName') {
            if ('projectId' in fields && projects[fields['projectId'].value as string]) {
              fields['projectName'] = { value: projects[fields['projectId'].value as string] };
            }
          }

          if (valueField in fields && labelField in fields) {
            labels[fields[valueField].value as string] = fields[labelField].value as string;
          }
        });
      });
    }

    const findValues: MetricFindValue[] = Object.keys(labels).map((key) => ({
      text: labels[key],
      value: key,
    }));
    findValues.sort((a, b) => String(a.value ?? '').localeCompare(String(b.value ?? '')));
    return findValues;
  }

  async getSilos(): Promise<Record<string, string>> {
    if (!Object.keys(this.silos).length) {
      const silos = await this.paginate<Silo>(SILO_URL);
      this.silos = Object.fromEntries(
        silos.map((silo) => {
          return [silo.id, silo.name];
        })
      );
    }
    return this.silos;
  }

  async getProjects(): Promise<Record<string, string>> {
    if (!Object.keys(this.projects).length) {
      const projects = await this.paginate<Project>(PROJECT_URL);
      this.projects = Object.fromEntries(
        projects.map((project) => {
          return [project.id, project.name];
        })
      );
    }
    return this.projects;
  }

  async query(options: DataQueryRequest<OxqlQuery>): Promise<DataQueryResponse> {
    const { range } = options;
    const from = range!.from.toISOString().slice(0, -1);
    const to = range!.to.toISOString().slice(0, -1);

    // Cache mappings from resource UUIDs to human-readable names. Note: we can
    // add mappings for higher-cardinality resources like instances and disks,
    // but this would add more latency to the 0th query on the page.
    //
    // TODO: add human-readable labels to metrics in oximeter so that we don't
    // have to enrich them here. Tracked in
    // https://github.com/oxidecomputer/omicron/issues/9119.
    const silos = await this.getSilos();
    const projects = await this.getProjects();

    const frames = await Promise.all(
      options.targets.map(async (target) => {
        let query = target.queryText;
        query = `${query} | filter timestamp > @${from} && timestamp < @${to}`;
        query = getTemplateSrv().replace(query, options.scopedVars);

        const body: TimeseriesQuery = { query: query };
        const response = await this.request<OxqlQueryResult>(QUERY_URL, 'POST', '', body);

        return buildDataFrames(response.data.tables, target, silos, projects);
      })
    );

    return { data: frames.flat() };
  }

  /**
   * Make a request to the Oxide API using the Grafana backend proxy.
   *
   * The Grafana backend proxy handles requests to the Oxide API, using the
   * configured host and API key. Because we don't send requests to the API
   * directly, we can't use oxide.ts to make requests and parse responses.
   * Instead, we use its types, and copy over helper functions to format
   * responses into the expected format.
   */
  async request<T>(
    url: string,
    method = 'GET',
    params?: string,
    data?: object
  ): Promise<{ status: number; statusText: string; data: T }> {
    const response = await lastValueFrom(
      getBackendSrv().fetch({
        method: method,
        url: `${this.baseUrl}${url}${params?.length ? `?${params}` : ''}`,
        data: data,
      })
    );
    return {
      status: response.status,
      statusText: response.statusText,
      data: processResponseBody(response.data) as T,
    };
  }

  async paginate<T>(url: string, params?: Record<string, string>): Promise<T[]> {
    params = params || {};
    const items: T[] = [];
    while (true) {
      const response = await this.request<{ items: T[]; nextPage?: string }>(
        url,
        'GET',
        new URLSearchParams(params).toString()
      );
      response.data.items.forEach((item) => {
        items.push(item);
      });
      if (response.data.nextPage) {
        params.page_token = response.data.nextPage;
      } else {
        break;
      }
    }
    return items;
  }

  /**
   * Checks whether we can connect to the API.
   */
  async testDatasource() {
    const defaultErrorMessage = 'Cannot connect to API';

    try {
      const response = await this.request('/v1/me');
      if (response.status === 200) {
        return {
          status: 'success',
          message: 'Success',
        };
      } else {
        return {
          status: 'error',
          message: response.statusText ? response.statusText : defaultErrorMessage,
        };
      }
    } catch (err) {
      let message = '';
      if (typeof err === 'string') {
        message = err;
      } else if (isFetchError(err)) {
        message = 'Fetch error: ' + (err.statusText ? err.statusText : defaultErrorMessage);
        if (err.data && err.data.error && err.data.error.code) {
          message += ': ' + err.data.error.code + '. ' + err.data.error.message;
        }
      }
      return {
        status: 'error',
        message,
      };
    }
  }
}

export function buildDataFrames(
  tables: OxqlTable[],
  target: OxqlQuery,
  silos: Record<string, string>,
  projects: Record<string, string>
): DataFrame[] {
  const frames: DataFrame[] = [];

  for (const table of tables) {
    // Parse timeseries names. In most cases, this field holds the name of a single timeseries.
    // But if the query includes a `| join`, the `name` field holds a comma-separated list of
    // joined timeseries names, in order.
    const seriesNames = table.name.split(',');

    for (const series of table.timeseries) {
      let labels: Record<string, string> = Object.fromEntries(
        Object.entries(series.fields).map(([key, value]) => {
          // Cast values to string to ensure falsy values are rendered properly.
          return [key, String(value.value)];
        })
      );

      // Enrich with labels from Oxide API.
      if (labels.siloId && silos[labels.siloId]) {
        labels.siloName = silos[labels.siloId];
      }
      if (labels.projectId && projects[labels.projectId]) {
        labels.projectName = projects[labels.projectId];
      }

      // Optionally render custom legend.
      if (target.legendFormat) {
        const legend = renderLegend(target.legendFormat, labels);
        labels = { legend: legend };
      }

      if (series.points.values.length !== seriesNames.length) {
        throw new Error(
          `Expected ${seriesNames.length} value dimension(s) for [${seriesNames.join(', ')}]; got ${
            series.points.values.length
          }`
        );
      }
      for (const [idx, value] of series.points.values.entries()) {
        // OxQL transparently converts cumulative metrics to deltas. However, the 0th value of
        // each resulting delta series represents the cumulative total of the series from its start
        // time to the timestamp of the 0th point. Because it's on a very different scale than the
        // following values, we omit it here. Note that series resets also use cumulative values,
        // but because they span a short time window, we don't omit them.
        let dataValues = value.values.values;
        let timestamps = series.points.timestamps;
        if (value.metricType === 'delta') {
          dataValues = dataValues.slice(1);
          timestamps = timestamps.slice(1);
        }
        frames.push(
          createDataFrame({
            name: seriesNames[idx],
            refId: target.refId,
            fields: [
              { name: 'Time', values: timestamps, type: FieldType.time },
              {
                name: 'Value',
                values: dataValues,
                labels: labels,
              },
            ],
          })
        );
      }
    }
  }

  return frames;
}

function renderLegend(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] || match;
  });
}
