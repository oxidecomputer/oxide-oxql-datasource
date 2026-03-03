import { test, expect } from '@grafana/plugin-e2e';

test('smoke: should render query editor', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await page.route('**/v1/system/timeseries/schemas*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ items: [], nextPage: null }) });
  });
  await panelEditPage.datasource.set(ds.name);
  const queryRow = panelEditPage.getQueryEditorRow('A');
  await expect(queryRow.getByText('Query Text')).toBeVisible();
  await expect(queryRow.getByText('Legend')).toBeVisible();
});
