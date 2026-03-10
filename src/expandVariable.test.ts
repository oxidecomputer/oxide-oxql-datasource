import { expandVariable } from './datasource';

describe('expandVariable', () => {
  const query = 'get metric:name | filter sled_id == "$sled_id" | align mean_within(5m)';

  it('removes the filter segment when values is empty', () => {
    expect(expandVariable(query, 'sled_id', [])).toBe('get metric:name | align mean_within(5m)');
  });

  it('removes the filter segment when values contains $__all', () => {
    expect(expandVariable(query, 'sled_id', ['$__all'])).toBe('get metric:name | align mean_within(5m)');
    expect(expandVariable(query, 'sled_id', ['$__all', 'id-1'])).toBe('get metric:name | align mean_within(5m)');
  });

  it('expands to OR chain for multiple values', () => {
    expect(expandVariable(query, 'sled_id', ['id-1', 'id-2', 'id-3'])).toBe(
      'get metric:name | filter (sled_id == "id-1" || sled_id == "id-2" || sled_id == "id-3") | align mean_within(5m)'
    );
  });

  it('leaves query unchanged when variable name does not match', () => {
    expect(expandVariable(query, 'project_id', ['p1', 'p2'])).toBe(query);
  });

  it('handles ${var} syntax', () => {
    const q = 'get metric:name | filter sled_id == "${sled_id}" | align mean_within(5m)';
    expect(expandVariable(q, 'sled_id', [])).toBe('get metric:name | align mean_within(5m)');
    expect(expandVariable(q, 'sled_id', ['id-1', 'id-2'])).toBe(
      'get metric:name | filter (sled_id == "id-1" || sled_id == "id-2") | align mean_within(5m)'
    );
  });

  it('expands multiple references to the same variable', () => {
    const q = 'get a | filter x == "$v" | join (get b | filter x == "$v")';
    expect(expandVariable(q, 'v', ['1', '2'])).toBe(
      'get a | filter (x == "1" || x == "2") | join (get b | filter (x == "1" || x == "2"))'
    );
  });

  it('handles single value (no expansion needed)', () => {
    expect(expandVariable(query, 'sled_id', ['only-one'])).toBe(
      'get metric:name | filter (sled_id == "only-one") | align mean_within(5m)'
    );
  });

  it('handles single-quoted variable references', () => {
    const q = "get metric:name | filter sled_id == '$sled_id' | align mean_within(5m)";
    expect(expandVariable(q, 'sled_id', [])).toBe('get metric:name | align mean_within(5m)');
    expect(expandVariable(q, 'sled_id', ['id-1', 'id-2'])).toBe(
      'get metric:name | filter (sled_id == "id-1" || sled_id == "id-2") | align mean_within(5m)'
    );
  });
});
