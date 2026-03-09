import { CustomVariableSupport, DataQueryRequest, DataQueryResponse, MetricFindValue } from '@grafana/data';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataSource } from './datasource';
import { OxqlQuery, OxqlOptions, OxqlVariableQuery } from './types';
import { VariableQueryEditor } from './components/VariableQueryEditor';

export class OxqlVariableSupport extends CustomVariableSupport<DataSource, OxqlVariableQuery, OxqlQuery, OxqlOptions> {
  private datasource: DataSource;

  constructor(datasource: DataSource) {
    super();
    this.datasource = datasource;
  }

  editor = VariableQueryEditor;

  query(request: DataQueryRequest<OxqlVariableQuery>): Observable<DataQueryResponse> {
    const target = request.targets[0];
    return from(this.datasource.executeVariableQuery(target)).pipe(
      map((values: MetricFindValue[]) => ({ data: values } as DataQueryResponse))
    );
  }
}
