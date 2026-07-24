import * as allThemes from "@lofcz/sandpack-themes";
import { storiesOf } from "@storybook/react";
import React from "react";

import {
  Sandpack,
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackPreview,
  SandpackProvider,
  SandpackLayout,
} from "../";
import { useSandpackFS } from "../utils/storyHelpers";

const stories = storiesOf("presets/Themes (external)", module);

Object.entries(allThemes).forEach(([themeName, value]) =>
  stories.add(themeName, () => {
    const fs1 = useSandpackFS({ template: "react" });
    const fs2 = useSandpackFS({ template: "react" });
    if (!fs1 || !fs2) return null;
    return (
      <>
        <Sandpack
          fs={fs1}
          options={{
            showLineNumbers: true,
            showInlineErrors: true,
            showNavigator: true,
            showTabs: true,
          }}
          theme={value}
        />

        <SandpackProvider fs={fs2} theme={value}>
          <SandpackLayout>
            <SandpackFileExplorer />
            <SandpackCodeEditor showLineNumbers showTabs />
            <SandpackPreview showNavigator />
          </SandpackLayout>
        </SandpackProvider>
      </>
    );
  }),
);
