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

/**
 * Copied from oxide.ts:
 * https://github.com/oxidecomputer/oxide.ts/blob/main/oxide-api/src/util.ts
 *
 * Copyright Oxide Computer Company
 * SPDX-License-Identifier: MPL-2.0
 */

export const snakeToCamel = (s: string) =>
  s.replace(/_./g, (l) => l[1].toUpperCase());

export const isObjectOrArray = (o: unknown) =>
  typeof o === 'object' &&
  !(o instanceof Date) &&
  !(o instanceof RegExp) &&
  !(o instanceof Error) &&
  o !== null;

export const mapObj =
  (
    kf: (k: string) => string,
    vf: (k: string | undefined, v: unknown) => unknown = (_, v) => v,
  ) =>
  (o: unknown): unknown => {
    if (!isObjectOrArray(o)) {
      return o;
    }

    if (Array.isArray(o)) {
      return o.map(mapObj(kf, vf));
    }

    const newObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      newObj[kf(k)] = isObjectOrArray(v) ? mapObj(kf, vf)(v) : vf(k, v);
    }
    return newObj;
  };

const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const parseIfDate = (k: string | undefined, v: unknown) => {
  if (
    typeof v === 'string' &&
    isoDateRegex.test(v) &&
    (k?.startsWith('time_') ||
      k?.endsWith('_time') ||
      k?.endsWith('_expiration') ||
      k === 'timestamp')
  ) {
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      return v;
    }
    return d;
  }
  return v;
};

export const processResponseBody = mapObj(snakeToCamel, parseIfDate);

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
