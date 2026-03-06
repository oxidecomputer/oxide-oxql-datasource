import { test, expect } from '@grafana/plugin-e2e';

test('smoke: should render query editor', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await page.route('/api/datasources/proxy/uid/*/v1/system/timeseries/schemas*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ items: [], nextPage: null }) });
  });
  await panelEditPage.datasource.set(ds.name);
  const queryRow = panelEditPage.getQueryEditorRow('A');
  await expect(queryRow.getByText('Query Text')).toBeVisible();
  await expect(queryRow.getByText('Legend')).toBeVisible();
});

test('should return data when a valid query is run', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });

  // Mock proxy endpoints.
  const queryResponse = {
    query_summaries: null,
    tables: [
      {
        name: 'sled_data_link:bytes_sent',
        timeseries: [
          {
            fields: { kind: { type: 'string', value: 'vnic' } },
            points: {
              start_times: null,
              timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'],
              values: [{ metric_type: 'gauge', values: { type: 'double', values: [100, 200] } }],
            },
          },
        ],
      },
    ],
  };
  const proxyPath = '/api/datasources/proxy/uid/*/v1';
  const emptyList = JSON.stringify({ items: [], next_page: null });
  await page.route(`${proxyPath}/system/timeseries/schemas*`, async (route) => {
    await route.fulfill({ status: 200, body: emptyList });
  });
  await page.route(`${proxyPath}/system/timeseries/query`, async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(queryResponse) });
  });
  await page.route(`${proxyPath}/system/silos*`, async (route) => {
    await route.fulfill({ status: 200, body: emptyList });
  });
  await page.route(`${proxyPath}/projects*`, async (route) => {
    await route.fulfill({ status: 200, body: emptyList });
  });

  // Enter a query into the editor.
  await panelEditPage.datasource.set(ds.name);
  const queryRow = panelEditPage.getQueryEditorRow('A');
  const codeEditor = queryRow.getByRole('textbox', { name: /Editor content/ });
  await codeEditor.click();
  await codeEditor.pressSequentially('get sled_data_link:bytes_sent | align mean_within(5m)');

  // Refresh, then wait for the query to execute.
  await expect(
    panelEditPage.refreshPanel({
      waitForResponsePredicateCallback: (resp) => resp.url().includes('/v1/system/timeseries/query'),
    })
  ).toBeOK();

  // Assert that the panel is populated.
  await expect(panelEditPage.panel.locator.getByText('vnic')).toBeVisible();
});

test('should autocomplete metric names', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });

  // Return two metrics from the schemas endpoint so the completion provider
  // has something to suggest.
  const schemas = {
    items: [
      { timeseries_name: 'sled_data_link:bytes_sent', field_schema: [], datum_type: 'f64', version: { version: 1 } },
      {
        timeseries_name: 'sled_data_link:bytes_received',
        field_schema: [],
        datum_type: 'f64',
        version: { version: 1 },
      },
    ],
    next_page: null,
  };
  await page.route('/api/datasources/proxy/uid/*/v1/system/timeseries/schemas*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(schemas) });
  });

  // Enter a partial metric name into the query editor.
  await panelEditPage.datasource.set(ds.name);
  const queryRow = panelEditPage.getQueryEditorRow('A');
  const codeEditor = queryRow.getByRole('textbox', { name: /Editor content/ });
  await codeEditor.click();
  await codeEditor.pressSequentially('get sled_data');

  // Assert expected completions.
  const completions = page.getByRole('listbox');
  await expect(completions).toBeVisible();
  await expect(completions.getByRole('option', { name: 'sled_data_link:bytes_sent' })).toBeVisible();
  await expect(completions.getByRole('option', { name: 'sled_data_link:bytes_received' })).toBeVisible();
});
