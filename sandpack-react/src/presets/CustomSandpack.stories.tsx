import React, { useEffect, useId, useRef, useState } from "react";

import {
  Sandpack,
  SandpackPreview,
  SandpackProvider,
  SandpackThemeProvider,
  OpenInCodeSandboxButton,
  RoundedButton,
  RefreshIcon,
  SandpackLayout,
  SandpackCodeViewer,
  SandpackCodeEditor,
  SandpackTranspiledCode,
  useSandpackTheme,
  useActiveCode,
  useSandpackNavigation,
  SandpackStack,
  UnstyledOpenInCodeSandboxButton,
  SandpackFileExplorer,
  SandpackConsumer,
  CodeEditor,
  type SandpackContext,
} from "../";
import { useSandpack } from "../hooks/useSandpack";
import { useSandpackFS } from "../utils/storyHelpers";

export default {
  title: "presets/Sandpack: custom",
};

export const ExperimentalServiceWorker: React.FC = () => {
  const fs = useSandpackFS({
    template: "react",
    files: {
      "/public/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-11.5 -10.23174 23 20.46348">
  <title>React Logo</title>
  <circle cx="0" cy="0" r="2.05" fill="#61dafb"/>
  <g stroke="#61dafb" stroke-width="1" fill="none">
    <ellipse rx="11" ry="4.2"/>
    <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
    <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
  </g>
</svg>
  `,
      "/App.js": `export default function App() {
  return (
    <>
      <h1>Hello React</h1>
      <img width="100" src="/public/logo.svg" />
    </>
  );
}
        `,
    },
  });
  if (!fs) return null;
  return (
    <Sandpack
      fs={fs}
      options={{
        experimental_enableServiceWorker: true,
        experimental_enableStableServiceWorkerId: true,
      }}
    />
  );
};

export const UsingSandpackLayout: React.FC = () => {
  const fs = useSandpackFS();
  if (!fs) return null;
  return (
    <SandpackProvider fs={fs}>
      <SandpackLayout>
        <SandpackStack>
          <SandpackTranspiledCode />
        </SandpackStack>
        <SandpackCodeEditor />
        <SandpackCodeViewer />
      </SandpackLayout>
    </SandpackProvider>
  );
};

export const UsingMultipleEditor: React.FC = () => {
  const [isAutoReload, setAutoReload] = React.useState(true);
  const fs = useSandpackFS({ template: "static" });
  if (!fs) return null;

  return (
    <div style={{ width: "100%", height: "500px" }}>
      <SandpackProvider
        fs={fs}
        options={{ initMode: "immediate", autoReload: isAutoReload }}
      >
        <SandpackConsumer>
          {(context: SandpackContext | null) => {
            if (!context) return <></>;

            const { updateFile, autoReload } = context;
            const { fileList, fs: ctxFs } = context;

            return (
              <SandpackLayout>
                <SandpackStack style={{ padding: "10px 0" }}>
                  <CodeEditor
                    code=""
                    filePath={fileList[0] ?? "/index.html"}
                    initMode="immediate"
                    onCodeUpdate={(newCode) => {
                      if (fileList[0])
                        updateFile(fileList[0], newCode, autoReload);
                    }}
                  />
                </SandpackStack>

                <SandpackStack style={{ padding: "10px 0" }}>
                  <CodeEditor
                    code=""
                    filePath={fileList[1] ?? "/styles.css"}
                    initMode="immediate"
                    onCodeUpdate={(newCode) => {
                      if (fileList[1])
                        updateFile(fileList[1], newCode, autoReload);
                    }}
                  />
                </SandpackStack>

                <SandpackPreview
                  actionsChildren={
                    <button onClick={() => setAutoReload((prev) => !prev)}>
                      Toggle autoReload to {JSON.stringify(!autoReload)}
                    </button>
                  }
                />
              </SandpackLayout>
            );
          }}
        </SandpackConsumer>
      </SandpackProvider>
    </div>
  );
};

export const UsingVisualElements: React.FC = () => {
  const fs = useSandpackFS({ template: "react" });
  if (!fs) return null;
  return (
    <SandpackProvider fs={fs} options={{ activeFile: "/App.js" }}>
      <SandpackThemeProvider>
        <SandpackCodeEditor
          style={{
            width: 500,
            height: 300,
          }}
        />

        <SandpackPreview
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
          style={{
            border: "1px solid red",
            marginBottom: 4,
            marginTop: 4,
            width: 500,
            height: 300,
          }}
        />

        <div
          style={{
            display: "flex",
            width: 500,
            justifyContent: "space-between",
          }}
        >
          <OpenInCodeSandboxButton />
          <RoundedButton>
            <RefreshIcon />
          </RoundedButton>
        </div>
      </SandpackThemeProvider>
    </SandpackProvider>
  );
};

const CustomRefreshButton = (): JSX.Element => {
  const { refresh } = useSandpackNavigation();

  return (
    <button onClick={(): void => refresh()} type="button">
      Refresh Sandpack
    </button>
  );
};

const CustomOpenInCSB = (): JSX.Element => {
  return (
    <UnstyledOpenInCodeSandboxButton>
      Open in CodeSandbox
    </UnstyledOpenInCodeSandboxButton>
  );
};

const CustomCodeEditor = (): JSX.Element => {
  const { code, updateCode } = useActiveCode();
  const { theme } = useSandpackTheme();

  return (
    <textarea
      onChange={(evt): void => updateCode(evt.target.value)}
      style={{
        width: 400,
        height: 200,
        padding: 8,
        fontFamily: theme.font.mono,
        fontSize: theme.font.size,
        background: theme.colors.surface1,
        border: `1px solid ${theme.colors.surface2}`,
        color: theme.colors.base,
        lineHeight: theme.font.lineHeight,
      }}
    >
      {code}
    </textarea>
  );
};

export const UsingHooks: React.FC = () => {
  const fs = useSandpackFS();
  if (!fs) return null;
  return (
    <SandpackProvider fs={fs}>
      <SandpackThemeProvider>
        <CustomCodeEditor />

        <SandpackPreview
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
          style={{ border: "1px solid red", width: 400, height: 300 }}
        />

        <div
          style={{
            display: "flex",
            width: 400,
            margin: "8px 0",
            justifyContent: "space-between",
          }}
        >
          <CustomRefreshButton />
          <CustomOpenInCSB />
        </div>

        <div style={{ width: 400 }}>
          <SandpackTranspiledCode />
        </div>
      </SandpackThemeProvider>
    </SandpackProvider>
  );
};

const code1 = `import React from 'react'

function Kitten() {
  return (
    <img
      src="https://placekitten.com/200/200"
      alt="Kitten"
    />
  )
}

export default function KittenGallery() {
  return (
    <section>
      <h1>A Gallery of Adorable Kittens</h1>
      <Kitten />
      <Kitten />
      <Kitten />
    </section>
  );
}`;

const code2 = `import React from 'react'

export default function KittenGallery() {
  return (
    <img
      src="https://placekitten.com/200/200"
      alt="Kitten"
    />
  )
}`;

const JustIframeContent: React.FC<{ code1: string; code2: string }> = ({
  code1: c1,
  code2: c2,
}) => {
  const [first, setFirst] = React.useState(true);
  const { sandpack } = useSandpack();
  const iframeRef = useRef<HTMLIFrameElement>();

  useEffect(() => {
    sandpack.registerBundler(iframeRef.current, "custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sandpack.updateFile("/App.js", first ? c1 : c2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  return (
    <>
      <iframe
        ref={iframeRef}
        style={{ width: 400, height: 400 }}
        title="Sandpack Preview"
      />
      <div
        style={{
          display: "flex",
          width: 400,
          margin: "8px 0",
          justifyContent: "space-between",
        }}
      >
        <CustomRefreshButton />
        <button onClick={(): void => setFirst(!first)} type="button">
          Switch
        </button>
        <CustomOpenInCSB />
      </div>
    </>
  );
};

export const JustIframe = (): React.ReactElement | null => {
  const fs = useSandpackFS({
    template: "react",
    files: { "/App.js": code1 },
  });
  if (!fs) return null;
  return (
    <SandpackProvider fs={fs}>
      <JustIframeContent code1={code1} code2={code2} />
    </SandpackProvider>
  );
};

export const MultiplePreviews: React.FC = () => {
  const [count, setCount] = useState(2);
  const fs = useSandpackFS();
  if (!fs) return null;

  const previews = Array.from(Array(count).keys());

  return (
    <>
      <SandpackProvider fs={fs}>
        <SandpackLayout>
          <SandpackCodeEditor />
          {previews.map((pr) => (
            <SandpackPreview key={pr} />
          ))}
        </SandpackLayout>
      </SandpackProvider>
      <button onClick={(): void => setCount(count + 1)}>Add</button>
      <button onClick={(): void => setCount(count - 1)}>Remove</button>
    </>
  );
};

const SandpackListener: React.FC = () => {
  const { listen } = useSandpack();
  const id = useId();

  useEffect(() => {
    // eslint-disable-next-line no-console
    const unsubscribe = listen((msg) => console.log(id, msg));

    return unsubscribe;
  }, [listen]);

  return null;
};

export const MultiplePreviewsAndListeners: React.FC = () => {
  const [count, setCount] = useState(2);
  const [listenersCount, setListenersCount] = useState(0);
  const fs = useSandpackFS({ template: "static" });
  if (!fs) return null;

  const previews = Array.from(Array(count).keys());

  return (
    <>
      <SandpackProvider fs={fs} options={{ autorun: true, autoReload: true }}>
        {new Array(listenersCount).fill(" ").map((_pr, index) => (
          <SandpackListener key={index} />
        ))}
        <SandpackLayout>
          <SandpackCodeEditor />
          {previews.map((pr) => (
            <SandpackPreview key={pr} />
          ))}
        </SandpackLayout>
      </SandpackProvider>
      <button onClick={(): void => setCount(count + 1)}>Add</button>
      <button onClick={(): void => setCount(count - 1)}>Remove</button>

      <p>Amount of listeners: {listenersCount}</p>
      <button onClick={(): void => setListenersCount(listenersCount + 1)}>
        Add listener
      </button>
      <button onClick={(): void => setListenersCount(listenersCount - 1)}>
        Remove listener
      </button>
    </>
  );
};

export const ClosableTabs: React.FC = () => {
  const fs = useSandpackFS({ template: "react" });
  if (!fs) return null;
  return (
    <Sandpack
      fs={fs}
      options={{ closableTabs: true, visibleFiles: ["/App.js", "/index.js"] }}
    />
  );
};

const ListenerIframeMessage = (): JSX.Element => {
  const [message, setMessage] = useState("Hello world");
  const { sandpack } = useSandpack();

  const sender = (): void => {
    Object.values(sandpack.clients).forEach((client) => {
      client.iframe.contentWindow.postMessage(message, "*");
    });
  };

  return (
    <>
      <button onClick={sender}>Send message</button>
      <input
        onChange={({ target }): void => setMessage(target.value)}
        value={message}
      />
    </>
  );
};

export const IframeMessage: React.FC = () => {
  const fs = useSandpackFS({
    template: "react",
    files: {
      "/App.js": `import {useState, useEffect} from "react";

export default function App() {
const [message, setMessage] = useState("")

useEffect(() => {
  window.addEventListener("message", (event) => {
    setMessage(event.data);
  });
}, [])

return <h1>{message}</h1>
}
`,
    },
  });
  if (!fs) return null;
  return (
    <SandpackProvider fs={fs}>
      <ListenerIframeMessage />
      <SandpackLayout>
        <SandpackCodeEditor />
        <SandpackPreview />
      </SandpackLayout>
    </SandpackProvider>
  );
};

export const CustomNpmRegistries: React.FC = () => {
  const fs = useSandpackFS({
    template: "react",
    customSetup: {
      dependencies: { "@codesandbox/test-package": "1.0.5" },
    },
    files: {
      "/App.js": `import { Button } from "@codesandbox/test-package"

export default function App() {
  return (
    <div>
      <Button>I'm a private Package</Button>
    </div>
  )
}
`,
    },
  });
  if (!fs) return null;
  return (
    <Sandpack
      fs={fs}
      npmRegistries={[
        {
          enabledScopes: ["@codesandbox"],
          limitToScopes: true,
          registryUrl: "https://xywctu-4000.preview.csb.app",
        },
      ]}
    />
  );
};

export const HiddenHeadTags: React.FC = () => {
  const sharedFiles = {
    "hidden-test.js": `
function alertTest() {
  alert('Hidden Script Test');
}
`,
    "hidden-test-1.css": `
body {
  background-color: red;
}
`,
    "hidden-test-2.css": `
body {
  background-color: blue;
}
`,
    "index.html": `
<!DOCTYPE html>
<html>

<head>
  <title>Parcel Sandbox</title>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="/styles.css" />
</head>

<body class="flex items-center justify-center">
  <button class="p-4 bg-white rounded" onClick="alertTest()">Alert</button>
</body>

</html>
`,
  };

  const sharedOptions = {
    externalResources: [
      "https://unpkg.com/@tailwindcss/ui/dist/tailwind-ui.min.css",
      "/hidden-test.js",
      "/hidden-test-1.css",
      "/hidden-test-2.css",
    ],
  };

  const fs1 = useSandpackFS({ template: "static", files: sharedFiles });
  const fs2 = useSandpackFS({ template: "static", files: sharedFiles });
  if (!fs1 || !fs2) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <div>Sandpack Component</div>
        <Sandpack fs={fs1} options={sharedOptions} />
      </div>
      <div>
        <div>Sandpack Provider Component</div>
        <SandpackProvider fs={fs2} options={sharedOptions}>
          <SandpackLayout>
            <SandpackFileExplorer />
            <SandpackCodeEditor closableTabs showLineNumbers />
            <SandpackPreview />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  );
};
