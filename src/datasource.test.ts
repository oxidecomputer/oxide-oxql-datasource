import { FieldType } from '@grafana/data';
import type { OxqlTable, TimeseriesSchema } from '@oxide/api';
import { buildDataFrames, DataSource } from './datasource';
import { type OxqlQuery, processResponseBody } from './types';

const makeTable = (name: string, timeseries: unknown[]): OxqlTable => {
  const result = processResponseBody({ tables: [{ name, timeseries }] }) as { tables: OxqlTable[] };
  return result.tables[0];
};

const target = { refId: 'A', queryText: '' } as OxqlQuery;

describe('buildDataFrames', () => {
  it('converts a single table to a data frame', () => {
    const tables = [
      makeTable('sled_data_link:bytes_sent', [
        {
          fields: { kind: { type: 'string', value: 'vnic' } },
          points: {
            timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
            values: [{ metric_type: 'gauge', values: { values: [100, 200] } }],
          },
        },
      ]),
    ];

    const frames = buildDataFrames(tables, target, {}, {});

    expect(frames).toEqual([
      {
        name: 'sled_data_link:bytes_sent',
        refId: 'A',
        length: 2,
        fields: [
          {
            name: 'Time',
            type: FieldType.time,
            config: {},
            values: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
          },
          {
            name: 'Value',
            type: FieldType.number,
            config: {},
            values: [100, 200],
            labels: { kind: 'vnic' },
          },
        ],
      },
    ]);
  });

  it('converts joined timeseries into separate frames per series', () => {
    const tables = [
      makeTable('sled_data_link:bytes_sent,sled_data_link:bytes_received', [
        {
          fields: { kind: { type: 'string', value: 'vnic' } },
          points: {
            timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
            values: [
              { metric_type: 'gauge', values: { values: [100, 200] } },
              { metric_type: 'gauge', values: { values: [300, 400] } },
            ],
          },
        },
      ]),
    ];

    const frames = buildDataFrames(tables, target, {}, {});

    expect(frames).toEqual([
      {
        name: 'sled_data_link:bytes_sent',
        refId: 'A',
        length: 2,
        fields: [
          {
            name: 'Time',
            type: FieldType.time,
            config: {},
            values: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
          },
          {
            name: 'Value',
            type: FieldType.number,
            config: {},
            values: [100, 200],
            labels: { kind: 'vnic' },
          },
        ],
      },
      {
        name: 'sled_data_link:bytes_received',
        refId: 'A',
        length: 2,
        fields: [
          {
            name: 'Time',
            type: FieldType.time,
            config: {},
            values: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
          },
          {
            name: 'Value',
            type: FieldType.number,
            config: {},
            values: [300, 400],
            labels: { kind: 'vnic' },
          },
        ],
      },
    ]);
  });

  it('enriches labels with silo and project names', () => {
    const tables = [
      makeTable('metric:name', [
        {
          fields: {
            silo_id: { type: 'uuid', value: 'silo-1' },
            project_id: { type: 'uuid', value: 'proj-1' },
          },
          points: {
            timestamps: ['2026-01-01T00:00:00Z'],
            values: [{ metric_type: 'gauge', values: { values: [42] } }],
          },
        },
      ]),
    ];

    const silos = { 'silo-1': 'my-silo' };
    const projects = { 'proj-1': 'my-project' };
    const frames = buildDataFrames(tables, target, silos, projects);

    expect(frames[0].fields[1].labels).toEqual({
      silo_id: 'silo-1',
      silo_name: 'my-silo',
      project_id: 'proj-1',
      project_name: 'my-project',
    });
  });

  it('applies custom legend format', () => {
    const tables = [
      makeTable('metric:name', [
        {
          fields: {
            kind: { type: 'string', value: 'vnic' },
            link_name: { type: 'string', value: 'eth0' },
          },
          points: {
            timestamps: ['2026-01-01T00:00:00Z'],
            values: [{ metric_type: 'gauge', values: { values: [42] } }],
          },
        },
      ]),
    ];

    const targetWithLegend = { ...target, legendFormat: '{{ kind }} - {{ link_name }}' };
    const frames = buildDataFrames(tables, targetWithLegend, {}, {});

    expect(frames[0].fields[1].labels).toEqual({ legend: 'vnic - eth0' });
  });

  it('skips the 0th value for delta metrics', () => {
    const tables = [
      makeTable('metric:name', [
        {
          fields: { kind: { type: 'string', value: 'vnic' } },
          points: {
            timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z'],
            values: [{ metric_type: 'delta', values: { values: [500, 100, 200] } }],
          },
        },
      ]),
    ];

    const frames = buildDataFrames(tables, target, {}, {});

    expect(frames[0].fields[0].values).toEqual(['2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z']);
    expect(frames[0].fields[1].values).toEqual([100, 200]);
  });

  it('throws when value dimensions do not match series names', () => {
    const tables = [
      makeTable('only_one_name', [
        {
          fields: { kind: { type: 'string', value: 'vnic' } },
          points: {
            timestamps: ['2026-01-01T00:00:00Z'],
            values: [
              { metric_type: 'gauge', values: { values: [1] } },
              { metric_type: 'gauge', values: { values: [2] } },
            ],
          },
        },
      ]),
    ];

    expect(() => buildDataFrames(tables, target, {}, {})).toThrow(
      'Expected 1 value dimension(s) for [only_one_name]; got 2'
    );
  });
});

describe('getFieldsForMetric', () => {
  function makeDatasource(schemas: Array<Pick<TimeseriesSchema, 'timeseriesName' | 'fieldSchema'>>): DataSource {
    const ds = { schemas } as unknown as DataSource;
    ds.getSchemas = DataSource.prototype.getSchemas.bind(ds);
    ds.getFieldsForMetric = DataSource.prototype.getFieldsForMetric.bind(ds);
    return ds;
  }

  it('returns real fields for value and no synthetic display fields', async () => {
    const ds = makeDatasource([
      {
        timeseriesName: 'metric:name',
        fieldSchema: [
          { name: 'kind', fieldType: 'string', source: 'target', description: '' },
          { name: 'link_name', fieldType: 'string', source: 'target', description: '' },
        ],
      },
    ]);

    const result = await ds.getFieldsForMetric('metric:name');
    expect(result.fields).toEqual(['kind', 'link_name']);
    expect(result.displayFields).toEqual([]);
  });

  it('adds silo_name and project_name as display-only fields', async () => {
    const ds = makeDatasource([
      {
        timeseriesName: 'metric:name',
        fieldSchema: [
          { name: 'silo_id', fieldType: 'uuid', source: 'target', description: '' },
          { name: 'project_id', fieldType: 'uuid', source: 'target', description: '' },
          { name: 'kind', fieldType: 'string', source: 'target', description: '' },
        ],
      },
    ]);

    const result = await ds.getFieldsForMetric('metric:name');
    expect(result.fields).toEqual(['silo_id', 'project_id', 'kind']);
    expect(result.displayFields).toEqual(['silo_name', 'project_name']);
  });
});
