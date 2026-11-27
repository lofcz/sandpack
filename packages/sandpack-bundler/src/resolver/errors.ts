import { ModuleNotFoundError } from '../errors/ModuleNotFound';

// Both are module-not-found errors to every caller (same class, same code): the
// message says which package rule refused the import instead of "Cannot find module".

/** A package with `exports` does not export the imported subpath (Node's ERR_PACKAGE_PATH_NOT_EXPORTED). */
export class PackagePathNotExportedError extends ModuleNotFoundError {
  constructor(specifier: string, parent: string, packageName: string, subpath: string, excluded: boolean) {
    super(specifier, parent);
    const why = excluded
      ? 'its "exports" exclude that path or define it only for environments other than the browser'
      : 'its "exports" do not list that path and the package has no such file';
    this.message = `Package path "${subpath}" is not exported by the package "${packageName}": ${why} (imported as '${specifier}' from '${parent}')`;
  }
}

/** A `#name` specifier the importing package's `imports` does not define (Node's ERR_PACKAGE_IMPORT_NOT_DEFINED). */
export class PackageImportNotDefinedError extends ModuleNotFoundError {
  constructor(specifier: string, parent: string, packageJsonPath: string | undefined) {
    super(specifier, parent);
    const where = packageJsonPath ? `the "imports" of ${packageJsonPath}` : 'any package.json "imports"';
    this.message = `Package import '${specifier}' is not defined for the browser in ${where} (imported from '${parent}')`;
  }
}
