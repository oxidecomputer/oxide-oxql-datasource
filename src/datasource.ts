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

import type { OxqlQueryResult, OxqlTable, Silo, Project, TimeseriesQuery, TimeseriesSchema } from '@oxide/api';
import { OxqlQuery, OxqlOptions, OxqlVariableQuery, DEFAULT_QUERY, processResponseBody } from './types';
import { OxqlVariableSupport } from './variableSupport';
import { lastValueFrom } from 'rxjs';

const QUERY_URL = '/v1/system/timeseries/query';
const SILO_URL = '/v1/system/silos';
const PROJECT_URL = '/v1/projects';

export class DataSource extends DataSourceApi<OxqlQuery, OxqlOptions> {
  baseUrl: string;
  projects: Record<string, string> = {};
  silos: Record<string, string> = {};
  schemas: TimeseriesSchema[] = [];
  fieldTypes: Map<string, string> = new Map();

  constructor(instanceSettings: DataSourceInstanceSettings<OxqlOptions>) {
    super(instanceSettings);
    this.baseUrl = instanceSettings.url!;
    this.variables = new OxqlVariableSupport(this);
  }

  getDefaultQuery(_: CoreApp): Partial<OxqlQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: OxqlQuery): boolean {
    return !!query.queryText;
  }

  async getSchemas(): Promise<TimeseriesSchema[]> {
    if (!this.schemas.length) {
      this.schemas = await this.paginate<TimeseriesSchema>('/v1/system/timeseries/schemas');
    }
    return this.schemas;
  }

  async getFieldTypes(): Promise<Map<string, string>> {
    if (!this.fieldTypes.size) {
      const schemas = await this.getSchemas();
      for (const schema of schemas) {
        for (const field of schema.fieldSchema) {
          this.fieldTypes.set(field.name, field.fieldType);
        }
      }
    }
    return this.fieldTypes;
  }

  async listMetrics(): Promise<string[]> {
    const schemas = await this.getSchemas();
    return schemas.map((schema) => schema.timeseriesName);
  }

  async getFieldsForMetric(metric: string): Promise<{ fields: string[]; displayFields: string[] }> {
    const schemas = await this.getSchemas();
    const schema = schemas.find((schema) => schema.timeseriesName === metric);
    if (!schema) {
      return { fields: [], displayFields: [] };
    }
    const fields = schema.fieldSchema.map((field) => field.name);

    // Human-readable display fields for enrichment. These only exist as
    // display labels and can't be used in OxQL queries.
    const displayFields: string[] = [];
    if (fields.includes('silo_id')) {
      displayFields.push('silo_name');
    }
    if (fields.includes('project_id')) {
      displayFields.push('project_name');
    }

    return { fields, displayFields };
  }

  /**
   * Execute a variable query and return unique values for the given metric fields.
   */
  async executeVariableQuery(query: OxqlVariableQuery): Promise<MetricFindValue[]> {
    if (!query.metric) {
      return [];
    }

    const labels: Record<string, string> = {};

    const valueField = query.valueField;
    const textField = query.textField && query.textField.length > 0 ? query.textField : query.valueField;
    const body: TimeseriesQuery = { query: `get ${query.metric} | filter timestamp > @now() - 5m | last 1` };
    const response = await this.request<OxqlQueryResult>(QUERY_URL, 'POST', '', body);

    // Fetch related resources if requested.
    const silos = textField === 'silo_name' || valueField === 'silo_name' ? await this.getSilos() : {};
    const projects = textField === 'project_name' || valueField === 'project_name' ? await this.getProjects() : {};

    response.data.tables.forEach((table) => {
      table.timeseries.forEach((series) => {
        const fields = series.fields as Record<string, { value: string | number | boolean }>;
        if ('silo_id' in fields && silos[fields['silo_id'].value as string]) {
          fields['silo_name'] = { value: silos[fields['silo_id'].value as string] };
        }
        if ('project_id' in fields && projects[fields['project_id'].value as string]) {
          fields['project_name'] = { value: projects[fields['project_id'].value as string] };
        }

        if (valueField in fields && textField in fields) {
          labels[fields[valueField].value as string] = fields[textField].value as string;
        }
      });
    });

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
    const fieldTypes = await this.getFieldTypes();

    const frames = await Promise.all(
      options.targets.map(async (target) => {
        let query = target.queryText;
        query = `${query} | filter timestamp > @${from} && timestamp < @${to}`;
        query = expandMultiValueFilters(query, fieldTypes);
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
   * Check whether we can connect to the API.
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
      if (labels.silo_id && silos[labels.silo_id]) {
        labels.silo_name = silos[labels.silo_id];
      }
      if (labels.project_id && projects[labels.project_id]) {
        labels.project_name = projects[labels.project_id];
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

/**
 * OxQL field types that require quoted literals in filter expressions.
 * Strings, UUIDs, and IP addresses are quoted; integers and booleans
 * are not. See https://docs.oxide.computer/guides/metrics/oxql-tutorial.
 */
const QUOTED_FIELD_TYPES: Set<string> = new Set(['string', 'uuid', 'ip_addr']);

/**
 * Expand multi-value template variables in OxQL filter expressions.
 *
 * Note: we could use the regexp operator here instead, but OxQL only
 * supports regexp for string labels, which isn't enough for general use.
 */
function expandMultiValueFilters(query: string, fieldTypes: Map<string, string>): string {
  const variables = getTemplateSrv().getVariables() as Array<{ name: string; multi?: boolean; includeAll?: boolean }>;

  for (const variable of variables) {
    if (!variable.multi && !variable.includeAll) {
      continue;
    }

    const current = (variable as { current?: { value: unknown } }).current?.value;
    if (!Array.isArray(current)) {
      continue;
    }
    const fieldType = fieldTypes.get(variable.name);
    if (fieldType === undefined) {
      continue;
    }
    const quote = QUOTED_FIELD_TYPES.has(fieldType);
    query = expandVariable(query, variable.name, current, quote);
  }

  return query;
}

/**
 * Expand a variable reference in a query, either expanding the filter into
 * a set of '||'-joined filters if multiple values set, or removing it
 * entirely if set to $__all.
 */
export function expandVariable(query: string, varName: string, values: string[], quote: boolean): string {
  if (values.includes('$__all') || values.length === 0) {
    const pattern = new RegExp(`\\s*\\|\\s*filter\\s+\\w+\\s*==\\s*["']\\$\\{?${varName}\\}?["']`, 'g');
    return query.replace(pattern, '');
  }
  const pattern = new RegExp(`(\\w+)\\s*==\\s*["']\\$\\{?${varName}\\}?["']`, 'g');
  return query.replace(pattern, (_, field) => {
    const expanded = values
      .map((v) => {
        const literal = quote ? `"${v}"` : v;
        return `${field} == ${literal}`;
      })
      .join(' || ');
    return `(${expanded})`;
  });
}
