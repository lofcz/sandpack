// DEAD-CANDIDATE(2026-06): inherited upstream — the "Open in CodeSandbox" branded affordance is
// not an immediately.run feature; site-main gates it off via showOpenInCodeSandbox:false. Reachable
// from Preview, so flag-only (do not remove — it would break Preview's import). See
// DEPRECATION_CANDIDATES.md.
import type { JSX } from "react";

import {
  buttonClassName,
  iconStandaloneClassName,
  roundedButtonClassName,
} from "../../../styles/shared.css";
import { useClassNames } from "../../../utils/classNames";
import { ExportIcon } from "../../icons";

import { UnstyledOpenInCodeSandboxButton } from "./UnstyledOpenInCodeSandboxButton";

export const OpenInCodeSandboxButton = (): JSX.Element | null => {
  const classNames = useClassNames();

  return (
    <UnstyledOpenInCodeSandboxButton
      className={classNames("button", [
        classNames("icon-standalone"),
        buttonClassName,
        iconStandaloneClassName,
        roundedButtonClassName,
      ])}
    >
      <ExportIcon />
      <span>Open Sandbox</span>
    </UnstyledOpenInCodeSandboxButton>
  );
};
