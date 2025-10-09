import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface OxqlQuery extends DataQuery {
  queryText?: string;
  constant: number;
  legendFormat?: string;
}

export const DEFAULT_QUERY: Partial<OxqlQuery> = {
  constant: 6.5,
};

export interface DataPoint {
  Time: number;
  Value: number;
}

export interface DataSourceResponse {
  datapoints: DataPoint[];
}

/**
 * These are options configured for each DataSource instance
 */
export interface OxqlOptions extends DataSourceJsonData {
  host?: string;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface OxqlSecureOptions {
  apiKey?: string;
}
