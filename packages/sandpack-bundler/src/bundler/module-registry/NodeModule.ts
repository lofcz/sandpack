import { CDNModuleFileType } from './module-cdn';

export class NodeModule {
  name: string;
  version: string;
  files: Record<string, CDNModuleFileType>;
  // transient dependencies
  modules: string[];
  /**
   * `version` is the exact npm release the files came from, so they are also
   * addressable as `name@version` on the npm file origin. False for esm.sh
   * fallbacks, whose `version` is the requested range and whose files are
   * synthesized rather than the package's own.
   */
  pinned: boolean;

  constructor(name: string, version: string, files: Record<string, CDNModuleFileType>, modules: string[], pinned: boolean) {
    this.name = name;
    this.version = version;
    this.files = files;
    this.modules = modules;
    this.pinned = pinned;
  }
}
