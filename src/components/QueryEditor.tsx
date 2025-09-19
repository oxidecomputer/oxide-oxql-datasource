import React from 'react';
import { InlineField, Stack, CodeEditor, monacoTypes } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { OxqlOptions, OxqlQuery } from '../types';

type Props = QueryEditorProps<DataSource, OxqlQuery, OxqlOptions>;

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
  const onQueryChange = (value: string) => {
    onChange({ ...query, queryText: value });
  };

  const listMetrics = async () => {
    const metrics: string[] = [];
    let params = '';
    while (true) {
      const response = await datasource.request('/v1/system/timeseries/schemas', 'GET', params);
      const raw: any = response.data;
      raw.items.forEach((item: any) => {
        metrics.push(item.timeseries_name);
      });
      if (raw.next_page) {
        params = `page_token=${raw.next_page}`;
      } else {
        break;
      }
    }
    return metrics;
  };

  const handleEditorMount = async (editor: monacoTypes.editor.IStandaloneCodeEditor, monaco: typeof monacoTypes) => {
    const metrics = await listMetrics();

    monaco.languages.registerCompletionItemProvider('plaintext', {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        return {
          suggestions: metrics.map((metric) => ({
            label: metric,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: metric,
            detail: `Metric: ${metric}`,
            documentation: `Insert ${metric} metric`,
            range: range,
          })),
        };
      },
    });

    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      wordWrap: 'on',
    });
  };

  const { queryText } = query;

  return (
    <Stack gap={0}>
      <InlineField label="Query Text" labelWidth={16} tooltip="Not used yet">
        <div style={{ width: '300px' }}>
          <CodeEditor
            value={queryText || ''}
            language="plaintext"
            height="100px"
            onChange={onQueryChange}
            onEditorDidMount={handleEditorMount}
            showLineNumbers={false}
            showMiniMap={false}
          />
        </div>
      </InlineField>
    </Stack>
  );
}
