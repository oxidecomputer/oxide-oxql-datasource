import { getBackendSrv, getTemplateSrv, isFetchError } from '@grafana/runtime';
import _ from 'lodash';
import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  createDataFrame,
  FieldType,
  MetricFindValue,
} from '@grafana/data';

import { OxqlQuery, OxqlOptions, DEFAULT_QUERY, DataSourceResponse } from './types';
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
      const oxqlQuery = `get ${groups.metric} | filter timestamp > @now() - 5m | last 1`;
      const response = await this.request(QUERY_URL, 'POST', '', { query: oxqlQuery });
      const raw: any = response.data;

      // Fetch additional metadata from Oxide API if requested.
      let silos: Record<string, string> = {};
      if (groups.label === 'silo_name' || groups.value === 'silo_name') {
        silos = await this.getSilos();
      }
      let projects: Record<string, string> = {};
      if (groups.label === 'project_name' || groups.value === 'project_name') {
        projects = await this.getProjects();
      }

      raw.tables.forEach((table: any) => {
        table.timeseries.forEach((series: any) => {
          // Enrich series with additional metadata if requested.
          if (groups.label === 'silo_name' || groups.value === 'silo_name') {
            if ('silo_id' in series.fields && silos[series.fields['silo_id'].value]) {
              series.fields['silo_name'] = { value: silos[series.fields['silo_id'].value] };
            }
          }
          if (groups.label === 'project_name' || groups.value === 'project_name') {
            if ('project_id' in series.fields && projects[series.fields['project_id'].value]) {
              series.fields['project_name'] = { value: projects[series.fields['project_id'].value] };
            }
          }

          if (groups.value in series.fields && groups.label in series.fields) {
            const key = series.fields[groups.value].value;
            const value = series.fields[groups.label].value;
            labels[key] = value;
          }
        });
      });
    }

    const findValues: any = Object.keys(labels).map((key) => {
      return {
        text: labels[key],
        value: key,
      };
    });
    findValues.sort((a: any, b: any) => a.value - b.value);
    return findValues;
  }

  async getSilos(): Promise<Record<string, string>> {
    if (!Object.keys(this.silos).length) {
      const silos = await this.paginate(SILO_URL);
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
      const projects = await this.paginate(PROJECT_URL);
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
    // have to enrich them here.  Tracked in
    // https://github.com/oxidecomputer/omicron/issues/9119.
    const silos = await this.getSilos();
    const projects = await this.getProjects();

    const frames = await Promise.all(
      options.targets.map(async (target) => {
        let query = target.queryText;
        query = `${query} | filter timestamp > @${from} && timestamp < @${to}`;
        query = getTemplateSrv().replace(query, options.scopedVars);
        const legendFormat = target.legendFormat;

        const response = await this.request(QUERY_URL, 'POST', '', { query: query });
        const raw: any = response.data;

        return raw.tables.map((table: any) => {
          return table.timeseries.map((series: any) => {
            let labels = Object.keys(series.fields).reduce(
              (result, key) => {
                result[key] = series.fields[key].value;
                return result;
              },
              {} as Record<string, string>
            );

            // Enrich with labels from Oxide API.
            if (labels.silo_id && silos[labels.silo_id]) {
              labels.silo_name = silos[labels.silo_id];
            }
            if (labels.project_id && projects[labels.project_id]) {
              labels.project_name = projects[labels.project_id];
            }

            // Optionally render custom legend.
            if (legendFormat) {
              const legend = renderLegend(legendFormat, labels);
              labels = { legend: legend };
            }

            return createDataFrame({
              refId: target.refId,
              fields: [
                { name: 'Time', values: series.points.timestamps, type: FieldType.time },
                {
                  name: 'Value',
                  values: series.points.values[0].values.values.slice(1),
                  labels: labels,
                },
              ],
            });
          });
        });
      })
    );

    return { data: _.flattenDeep(frames) };
  }

  async request(url: string, method = 'GET', params?: string, data?: object) {
    const response = getBackendSrv().fetch<DataSourceResponse>({
      method: method,
      url: `${this.baseUrl}${url}${params?.length ? `?${params}` : ''}`,
      data: data,
    });
    return lastValueFrom(response);
  }

  async paginate(url: string, params?: Record<string, string>) {
    params = params || {};
    const items: any[] = [];
    while (true) {
      const response = await this.request(url, 'GET', new URLSearchParams(params).toString());
      const raw: any = response.data;
      raw.items.forEach((item: any) => {
        items.push(item);
      });
      if (raw.next_page) {
        params.page_token = raw.next_page;
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

/**
 * Render legendFormat templates with provided variables.
 */
function renderLegend(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] || match;
  });
}
