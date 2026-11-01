import { CDNModuleFileType } from './module-cdn';

/** An exact npm release: the files are addressable as `name@version`. */
export interface NpmRelease {
  name: string;
  version: string;
}

export class NodeModule {
  name: string;
  version: string;
  files: Record<string, CDNModuleFileType>;
  // transient dependencies
  modules: string[];
  /**
   * The npm release the files came from. Its name differs from `name` for an
   * `npm:` alias, and its version is exact where `version` may be an esm.sh
   * fallback's range. Null when the release is unknown (an esm.sh fallback
   * whose resolved version could not be determined).
   */
  release: NpmRelease | null;

  constructor(name: string, version: string, files: Record<string, CDNModuleFileType>, modules: string[], release: NpmRelease | null) {
    this.name = name;
    this.version = version;
    this.files = files;
    this.modules = modules;
    this.release = release;
  }
}
