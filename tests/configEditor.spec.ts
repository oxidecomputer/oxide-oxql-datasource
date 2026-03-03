import { test, expect } from '@grafana/plugin-e2e';

test('smoke: should render config editor', async ({ createDataSourceConfigPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });
  await expect(page.getByLabel('Host')).toBeVisible();
  await expect(page.getByLabel('API Key')).toBeVisible();
});

test('"Save & test" should be successful when health check passes', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  selectors,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  const healthCheckPath = `${selectors.apis.DataSource.proxy(
    configPage.datasource.uid,
    configPage.datasource.id.toString()
  )}/v1/me`;
  await page.route(healthCheckPath, async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ id: 'test' }) });
  });
  await expect(configPage.saveAndTest({ path: healthCheckPath })).toBeOK();
  await expect(configPage).toHaveAlert('success');
});

test('"Save & test" should display error when health check fails', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  selectors,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  const healthCheckPath = `${selectors.apis.DataSource.proxy(
    configPage.datasource.uid,
    configPage.datasource.id.toString()
  )}/v1/me`;
  await page.route(healthCheckPath, async (route) => {
    await route.fulfill({ status: 401, body: JSON.stringify({ message: 'Unauthorized' }) });
  });
  await expect(configPage.saveAndTest({ path: healthCheckPath })).not.toBeOK();
  await expect(configPage).toHaveAlert('error');
});
