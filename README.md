# Oxide OxQL Data Source for Grafana

Query and visualize metrics from an [Oxide](https://oxide.computer) rack using [OxQL](https://docs.oxide.computer/guides/metrics/oxql-tutorial) in Grafana.

## Installation

Install the plugin using the Grafana CLI:

```bash
grafana cli plugins install oxide-oxql-datasource
```

Or download the latest release from the [releases page](https://github.com/oxidecomputer/oxide-oxql-datasource/releases) and extract it to your Grafana plugins directory.

## Configuration

1. In Grafana, navigate to **Connections > Data Sources > Add data source**.
1. Search for "Oxql" and select it.
1. Enter your Oxide rack's API host (e.g., `https://silo.sys.oxide.example.com`) and an API key.
1. Click **Save & test** to verify the connection.

## Usage

### Querying

Enter an OxQL query in the query editor. For example:

```
get sled_data_link:bytes_sent | align mean_within(5m)
```

The plugin automatically appends a time range filter based on the Grafana time picker, so you don't need to include `| filter timestamp`.

Metric names autocomplete after the `get` keyword.

### Template variables

Define template variables using the `label_values` function in the variable query:

```
label_values(sled_data_link:bytes_sent, silo_id, silo_name)
```

This returns the distinct values of `silo_id` as variable values, labeled with the corresponding `silo_name`.

### Legend formatting

Use the **Legend** field to customize series names:

```
{{ kind }} - {{ linkName }}
```

Label values in `{{ braces }}` are replaced with the corresponding field values from each series.

## Development

### Prerequisites

- Node.js >= 22
- Docker and Docker Compose (for running Grafana locally)

### Getting started

Set `OXIDE_HOST` and `OXIDE_API_KEY` in a `.env` file or export them in your shell. These are passed to the Grafana container and used by the provisioned data source.

```bash
# Install dependencies
npm install

# Build the plugin in watch mode
npm run dev

# Start a local Grafana instance via docker compose
npm run server

# Run tests
npm run test:ci

# Run linting
npm run lint

# Run e2e tests
npm run server
npm run e2e
```

### Releasing

1. Update `CHANGELOG.md`: move items into the release version and remove `(Unreleased)`.
2. Add a new `## x.y.z (Unreleased)` section at the top for future changes.
3. Tag the release:
   ```bash
   npm version <major|minor|patch>
   git push origin main --follow-tags
   ```
4. The [release workflow](.github/workflows/release.yml) builds, signs, and publishes a GitHub release with the plugin zip.

## License

Apache-2.0
