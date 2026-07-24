import type { SandpackFS } from "@lofcz/sandpack-client";
import LZString from "lz-string";
import * as React from "react";

import { useSandpack } from "../../../hooks/useSandpack";
import type { SandboxEnvironment, SandpackState } from "../../../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getParameters = (parameters: Record<string, any>): string =>
  LZString.compressToBase64(JSON.stringify(parameters))
    .replace(/\+/g, "-") // Convert '+' to '-'
    .replace(/\//g, "_") // Convert '/' to '_'
    .replace(/=+$/, ""); /* Remove ending '='*/

const CSB_URL = "https://codesandbox.io/api/v1/sandboxes/define";

/**
 * Read the current filesystem contents into the flat shape expected by the
 * CodeSandbox `/define` endpoint.
 */
async function getFileParameters(
  fs: SandpackFS,
  fileList: string[],
  environment?: SandboxEnvironment,
): Promise<string> {
  const entries = await Promise.all(
    fileList.map(async (path) => {
      const fileName = path.replace(/^\//, "");
      const code = await fs.readFile(path);
      return [fileName, { content: code, isBinary: false }] as const;
    }),
  );

  return getParameters({
    files: Object.fromEntries(entries),
    ...(environment ? { template: environment } : null),
  });
}

export const UnstyledOpenInCodeSandboxButton: React.FC<
  React.HtmlHTMLAttributes<unknown>
> = (props) => {
  const { sandpack } = useSandpack();

  if (sandpack.exportOptions) {
    return <ExportToWorkspaceButton state={sandpack} {...props} />;
  }

  return <RegularExportButton state={sandpack} {...props} />;
};

export const ExportToWorkspaceButton: React.FC<
  React.HtmlHTMLAttributes<unknown> & { state: SandpackState }
> = ({ children, state, ...props }) => {
  const submit = async () => {
    if (!state.exportOptions?.apiToken) {
      throw new Error("Missing `apiToken` property");
    }

    const files = await Promise.all(
      state.fileList.map(async (path) => {
        const fileName = path.replace(/^\//, "");
        return [fileName, { code: await state.fs.readFile(path) }] as const;
      }),
    );
    const normalizedFiles = Object.fromEntries(files);

    const response = await fetch("https://api.codesandbox.io/sandbox", {
      method: "POST",
      body: JSON.stringify({
        template: state.environment,
        files: normalizedFiles,
        privacy: state.exportOptions.privacy === "public" ? 0 : 2,
      }),
      headers: {
        Authorization: `Bearer ${state.exportOptions.apiToken}`,
        "Content-Type": "application/json",
        "X-CSB-API-Version": "2023-07-01",
      },
    });

    const data: { data: { alias: string } } = await response.json();

    window.open(
      `https://codesandbox.io/p/sandbox/${data.data.alias}?file=/${state.activeFile}&utm-source=storybook-addon`,
      "_blank",
    );
  };

  return (
    <button
      onClick={submit}
      title="Export to workspace in CodeSandbox"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
};

const RegularExportButton: React.FC<
  React.HtmlHTMLAttributes<unknown> & { state: SandpackState }
> = ({ children, state, ...props }) => {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [paramsValues, setParamsValues] = React.useState<URLSearchParams>();

  React.useEffect(
    function debounce() {
      let cancelled = false;

      const timer = setTimeout(async () => {
        const params = await getFileParameters(
          state.fs,
          state.fileList,
          state.environment,
        );

        if (cancelled) return;

        const searchParams = new URLSearchParams({
          parameters: params,
          query: new URLSearchParams({
            file: state.activeFile,
            utm_medium: "sandpack",
          }).toString(),
        });

        setParamsValues(searchParams);
      }, 600);

      return (): void => {
        cancelled = true;
        clearTimeout(timer);
      };
    },
    [state.activeFile, state.environment, state.fs, state.fileList],
  );

  /**
   * This is a safe limit to avoid too long requests (401),
   * as all parameters are attached in the URL
   */
  if ((paramsValues?.get?.("parameters")?.length ?? 0) > 1500) {
    return (
      <button
        onClick={(): void => formRef.current?.submit()}
        title="Open in CodeSandbox"
        type="button"
        {...props}
      >
        <form
          ref={formRef}
          action={CSB_URL}
          method="POST"
          style={{ visibility: "hidden" }}
          target="_blank"
        >
          <input
            name="environment"
            type="hidden"
            value={state.environment === "node" ? "server" : state.environment}
          />
          {Array.from(
            paramsValues as unknown as Array<[string, string]>,
            ([key, value]) => (
              <input key={key} name={key} type="hidden" value={value} />
            ),
          )}
        </form>
        {children}
      </button>
    );
  }

  return (
    <a
      href={`${CSB_URL}?${paramsValues?.toString()}&environment=${
        state.environment === "node" ? "server" : state.environment
      }`}
      rel="noreferrer noopener"
      target="_blank"
      title="Open in CodeSandbox"
      {...props}
    >
      {children}
    </a>
  );
};
