import React, { useEffect, useState } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { Select, InlineField, InlineFieldRow } from '@grafana/ui';
import { DataSource } from '../datasource';
import { OxqlQuery, OxqlOptions, OxqlVariableQuery } from '../types';

type Props = QueryEditorProps<DataSource, OxqlQuery, OxqlOptions, OxqlVariableQuery>;

export function VariableQueryEditor({ datasource, query, onChange }: Props) {
  const [metrics, setMetrics] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [displayFields, setDisplayFields] = useState<string[]>([]);

  useEffect(() => {
    datasource.listMetrics().then(setMetrics);
  }, [datasource]);

  useEffect(() => {
    datasource.getFieldsForMetric(query.metric).then((result) => {
      setFields(result.fields);
      setDisplayFields(result.displayFields);
    });
  }, [datasource, query.metric]);

  const onMetricChange = (value: string) => {
    onChange({ ...query, metric: value, valueField: '', textField: '' });
  };

  const onValueFieldChange = (value: string) => {
    onChange({ ...query, valueField: value });
  };

  const onTextFieldChange = (value: string) => {
    onChange({ ...query, textField: value });
  };

  const metricOptions = metrics.map((metric) => ({ label: metric, value: metric }));
  const fieldOptions = fields.map((field) => ({ label: field, value: field }));
  const displayFieldOptions = displayFields.map((field) => ({ label: field, value: field }));

  return (
    <>
      <InlineFieldRow>
        <InlineField label="Metric" labelWidth={16} required>
          <Select options={metricOptions} value={query.metric} onChange={(v) => onMetricChange(v.value!)} width={30} />
        </InlineField>
      </InlineFieldRow>
      <InlineFieldRow>
        <InlineField
          label="Value"
          labelWidth={16}
          tooltip="The field used as the variable value when selected."
          required
        >
          <Select
            options={fieldOptions}
            value={query.valueField}
            onChange={(v) => onValueFieldChange(v.value!)}
            width={30}
            disabled={!query.metric}
          />
        </InlineField>
      </InlineFieldRow>
      <InlineFieldRow>
        <InlineField
          label="Text"
          labelWidth={16}
          tooltip="Optional display field, used to display using human-readable labels (e.g. project_name) for uuid labels (e.g. project_id). Defaults to the value field if empty."
        >
          <Select
            options={displayFieldOptions}
            value={query.textField}
            onChange={(v) => onTextFieldChange(v?.value ?? '')}
            width={30}
            disabled={!query.metric}
            isClearable
          />
        </InlineField>
      </InlineFieldRow>
    </>
  );
}
