import React from 'react';
import { InlineField, Stack, CodeEditor, monacoTypes, Input } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import type { TimeseriesSchema } from '@oxide/api';
import { DataSource } from '../datasource';
import { OxqlOptions, OxqlQuery } from '../types';

type Props = QueryEditorProps<DataSource, OxqlQuery, OxqlOptions>;

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
  const onQueryChange = (value: string) => {
    onChange({ ...query, queryText: value });
  };

  const onLegendFormatChange = (event: React.FormEvent<HTMLInputElement>) => {
    onChange({ ...query, legendFormat: event.currentTarget.value });
  };

  const listMetrics = async () => {
    const metrics: string[] = [];
    let params = '';
    while (true) {
      const response = await datasource.request<{ items: TimeseriesSchema[]; nextPage?: string }>(
        '/v1/system/timeseries/schemas',
        'GET',
        params
      );
      response.data.items.forEach((item) => {
        metrics.push(item.timeseriesName);
      });
      if (response.data.nextPage) {
        params = `page_token=${response.data.nextPage}`;
      } else {
        break;
      }
    }
    return metrics;
  };

  const handleEditorMount = async (editor: monacoTypes.editor.IStandaloneCodeEditor, monaco: typeof monacoTypes) => {
    const metrics = await listMetrics();

    // Define a simple Monaco language for OxQL.
    monaco.languages.register({ id: 'oxql' });

    monaco.languages.setLanguageConfiguration('oxql', {
      wordPattern: /[a-zA-Z0-9_:]+/,

      brackets: [['[', ']']],
      autoClosingPairs: [
        { open: '[', close: ']' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '[', close: ']' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    monaco.languages.setMonarchTokensProvider('oxql', {
      keywords: ['get', 'align', 'filter', 'group_by', 'first', 'last'],

      operators: ['&&', '||', '^', '^', '!', '==', '!=', '>', '>=', '<', '<=', '~='],

      symbols: /[=><!~?:&|+\-*\/\^%]+/,

      tokenizer: {
        root: [
          [
            /[a-zA-Z0-9_:]+/,
            {
              cases: {
                '@keywords': 'keyword',
                '@default': 'identifier',
              },
            },
          ],
          [
            /@symbols/,
            {
              cases: {
                '@operators': 'operator',
                '@default': '',
              },
            },
          ],
        ],
      },
    });

    monaco.languages.registerCompletionItemProvider('oxql', {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const prevWord = model.getWordUntilPosition(new monaco.Position(position.lineNumber, word.startColumn - 1));
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Show available metric names, but only following a "get" token.
        //
        // TODO: implement a more complete OxQL parser, handling keywords,
        // subqueries, filtering facets, etc.
        let suggestions: monacoTypes.languages.CompletionItem[] = [];
        if (prevWord && prevWord.word.toLowerCase() === 'get') {
          suggestions = metrics.map((metric) => ({
            label: metric,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: metric,
            detail: `Metric: ${metric}`,
            documentation: `Insert ${metric} metric`,
            range: range,
          }));
        }
        return { suggestions: suggestions };
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

  const { queryText, legendFormat } = query;

  return (
    <Stack gap={0}>
      <InlineField label="Query Text" labelWidth={16} tooltip="Not used yet">
        <div style={{ width: '300px' }}>
          <CodeEditor
            value={queryText || ''}
            language="oxql"
            height="100px"
            onChange={onQueryChange}
            onEditorDidMount={handleEditorMount}
            showLineNumbers={false}
            showMiniMap={false}
          />
        </div>
      </InlineField>
      <InlineField
        label="Legend"
        labelWidth={16}
        tooltip="Optional legend format. Values in {{ braces }} will be templated from result labels."
      >
        <Input value={legendFormat || ''} onChange={onLegendFormatChange} width={40} />
      </InlineField>
    </Stack>
  );
}
