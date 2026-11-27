import { getPotentialPathsFromTSConfig, mergeTSConfig, parseTSConfig, processTSConfig } from './tsconfig';

describe('tsconfig paths', () => {
  it('resolves paths from the config directory when there is no baseUrl', () => {
    const config = processTSConfig('{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }', '/app');
    expect(config).toEqual({ baseUrl: undefined, paths: { '@/*': ['/app/src/*'] } });
    // No baseUrl: a bare specifier is not looked up in the project.
    expect(getPotentialPathsFromTSConfig('@/components/Button', config!)).toEqual(['/app/src/components/Button']);
    expect(getPotentialPathsFromTSConfig('react', config!)).toEqual([]);
  });

  it('resolves paths and bare specifiers from baseUrl when it is set', () => {
    const config = processTSConfig('{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["./*"] } } }', '/app');
    expect(getPotentialPathsFromTSConfig('~/a/b', config!)).toEqual(['/app/src/a/b', '/app/src/~/a/b']);
  });

  it('picks the exact pattern, else the longest prefix, and fills a "*" anywhere', () => {
    const config = processTSConfig(
      JSON.stringify({
        compilerOptions: {
          paths: { '*': ['./any/*'], '@app/*': ['./app/*', './not_app/*'], '@app/ui/*': ['./ui/*/index'], '@app/ui/x': ['./x'] },
        },
      }),
      '/app'
    )!;
    expect(getPotentialPathsFromTSConfig('@app/ui/x', config)).toEqual(['/app/x']);
    expect(getPotentialPathsFromTSConfig('@app/ui/button', config)).toEqual(['/app/ui/button/index']);
    expect(getPotentialPathsFromTSConfig('@app/thing', config)).toEqual(['/app/app/thing', '/app/not_app/thing']);
    expect(getPotentialPathsFromTSConfig('lodash', config)).toEqual(['/app/any/lodash']);
  });

  it('takes what the config lacks from the config it extends', () => {
    const base = parseTSConfig('{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }', '/app/config');
    const own = parseTSConfig('{ "extends": "./config/base", "compilerOptions": { "strict": true } }', '/app');
    expect(own.extends).toEqual(['/app/config/base.json']);
    // Declared in the base without baseUrl: relative to the base's directory.
    expect(mergeTSConfig(own, [base])).toEqual({ baseUrl: undefined, paths: { '@/*': ['/app/config/src/*'] } });

    const withBaseUrl = parseTSConfig('{ "extends": "./config/base.json", "compilerOptions": { "baseUrl": "." } }', '/app');
    expect(mergeTSConfig(withBaseUrl, [base])).toEqual({ baseUrl: '/app', paths: { '@/*': ['/app/src/*'] } });
  });

  it('does not follow a package config and tolerates comments', () => {
    const own = parseTSConfig('{ // comment\n "extends": "@tsconfig/vite-react/tsconfig.json" }', '/app');
    expect(own.extends).toEqual([]);
    expect(mergeTSConfig(own)).toBeNull();
  });
});
