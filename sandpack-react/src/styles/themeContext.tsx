import { assignInlineVars } from "@vanilla-extract/dynamic";
import * as React from "react";

import { defaultLight } from "../themes";
import type { SandpackTheme, SandpackThemeProp } from "../types";
import { useClassNames } from "../utils/classNames";

import { wrapperClassName } from "./themeContext.css";

import { standardizeTheme, themeVars, vars } from ".";

const SandpackThemeContext = React.createContext<{
  theme: SandpackTheme;
  id: string;
  mode: "dark" | "light" | "auto";
}>({
  theme: defaultLight,
  id: "light",
  mode: "light",
});

/**
 * @category Theme
 */
const SandpackThemeProvider: React.FC<
  React.HTMLAttributes<HTMLDivElement> & {
    theme?: SandpackThemeProp;
    children?: React.ReactNode;
  }
> = ({
  theme: themeFromProps,
  children,
  className,
  style: styleFromProps,
  ...props
}) => {
  const [prefferedTheme, setPreferredTheme] = React.useState<
    SandpackThemeProp | undefined
  >(themeFromProps);
  const { theme, id, mode } = standardizeTheme(prefferedTheme);
  const classNames = useClassNames();

  const themeStyle = React.useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => assignInlineVars(vars as any, themeVars(theme) as any),
    [theme],
  );

  React.useEffect(() => {
    if (themeFromProps !== "auto") {
      setPreferredTheme(themeFromProps);
      return;
    }

    const colorSchemeChange = ({ matches }: MediaQueryListEvent) => {
      setPreferredTheme(matches ? "dark" : "light");
    };

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", colorSchemeChange);

    return () => {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", colorSchemeChange);
    };
  }, [themeFromProps]);

  return (
    <SandpackThemeContext.Provider value={{ theme, id, mode }}>
      <div
        className={classNames("wrapper", [
          wrapperClassName({ variant: mode }),
          className,
        ])}
        data-sandpack-theme-id={id}
        style={{ ...themeStyle, ...styleFromProps }}
        {...props}
      >
        {children}
      </div>
    </SandpackThemeContext.Provider>
  );
};

const SandpackThemeConsumer = SandpackThemeContext.Consumer;

export { SandpackThemeProvider, SandpackThemeConsumer, SandpackThemeContext };
