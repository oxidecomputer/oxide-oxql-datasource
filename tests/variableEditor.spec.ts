import { test, expect } from '@grafana/plugin-e2e';

test('should render variable query editor and return values', async ({
  variableEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });

  const proxyPath = '/api/datasources/proxy/uid/*/v1';

  // Mock the schemas endpoint with a metric that has a sled_id field.
  const schemas = {
    items: [
      {
        timeseries_name: 'sled_data_link:bytes_sent',
        field_schema: [
          { name: 'sled_id', field_type: 'uuid', source: 'target', description: '' },
          { name: 'kind', field_type: 'string', source: 'target', description: '' },
        ],
        datum_type: 'f64',
        version: { version: 1 },
      },
    ],
    next_page: null,
  };
  await page.route(`${proxyPath}/system/timeseries/schemas*`, async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(schemas) });
  });

  // Mock the query endpoint to return timeseries with two distinct sled_ids.
  const queryResponse = {
    tables: [
      {
        name: 'sled_data_link:bytes_sent',
        timeseries: [
          {
            fields: { sled_id: { type: 'uuid', value: 'sled-a' }, kind: { type: 'string', value: 'vnic' } },
            points: {
              timestamps: ['2026-01-01T00:00:00Z'],
              values: [{ metric_type: 'gauge', values: { type: 'double', values: [1] } }],
            },
          },
          {
            fields: { sled_id: { type: 'uuid', value: 'sled-b' }, kind: { type: 'string', value: 'vnic' } },
            points: {
              timestamps: ['2026-01-01T00:00:00Z'],
              values: [{ metric_type: 'gauge', values: { type: 'double', values: [2] } }],
            },
          },
        ],
      },
    ],
  };
  await page.route(`${proxyPath}/system/timeseries/query`, async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(queryResponse) });
  });

  // Toggle variable type to ensure that we're loading the widget after mocks
  // are in place.
  await variableEditPage.setVariableType('Custom');
  await variableEditPage.setVariableType('Query');
  await variableEditPage.datasource.set(ds.name);

  // Verify the custom editor renders with our three fields.
  await expect(page.getByText('Metric *')).toBeVisible();
  await expect(page.getByText('Value *')).toBeVisible();
  await expect(page.getByText('Text', { exact: true })).toBeVisible();

  // Select a metric from the Metric dropdown. Use getByText inside the listbox
  // because older Grafana versions give every option the ARIA name "Select
  // option" instead of the actual metric name.
  const metricSelect = page.getByText('Metric *').locator('..').getByRole('combobox');
  await metricSelect.click();
  await page.getByRole('listbox').getByText('sled_data_link:bytes_sent').click();

  // After selecting a metric, the Value and Text dropdowns should have field
  // options. Click the Value dropdown and verify the field options appear.
  const valueSelect = page.getByText('Value *').locator('..').getByRole('combobox');
  await valueSelect.click();
  await expect(page.getByRole('listbox').getByText('sled_id')).toBeVisible();
  await expect(page.getByRole('listbox').getByText('kind')).toBeVisible();

  // Select sled_id as the value field, then run the query.
  await page.getByRole('listbox').getByText('sled_id').click();
  const queryResponsePromise = page.waitForResponse((resp) => resp.url().includes('/v1/system/timeseries/query'));
  await variableEditPage.runQuery();
  await queryResponsePromise;

  // Verify the preview shows the two distinct sled_id values from the mocked response.
  await expect(variableEditPage).toDisplayPreviews(['sled-a', 'sled-b']);
});
