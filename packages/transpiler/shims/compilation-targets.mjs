// `isRequired(name, targets, { compatData })` answers "does any target lack
// this feature?". The polyfill-provider helper asks it for every candidate
// polyfill of every member access in a file, and each call parses the version
// strings of the targets and of the compat entry again: in a 2,000-line file
// that parsing was a fifth of the whole transform (measured with --cpu-prof).
//
// The answer depends only on its arguments, and the provider passes the same
// `targets` and `compatData` objects for as long as its plugin instance lives,
// so the build gives the provider this module: the real function, remembered.
import getTargets, { isRequired as computeIsRequired } from '@babel/helper-compilation-targets';

export * from '@babel/helper-compilation-targets';
export default getTargets;

/** compatData -> targets -> name -> answer */
const answers = new WeakMap();

export function isRequired(name, targets, options = {}) {
  const { compatData, includes, excludes } = options;
  // An include/exclude list changes the answer, and the default compat data
  // has no object to key on: ask the real function.
  if (!compatData || !targets || includes?.size || excludes?.size) {
    return computeIsRequired(name, targets, options);
  }
  let byTargets = answers.get(compatData);
  if (!byTargets) answers.set(compatData, (byTargets = new WeakMap()));
  let byName = byTargets.get(targets);
  if (!byName) byTargets.set(targets, (byName = new Map()));
  let answer = byName.get(name);
  if (answer === undefined) byName.set(name, (answer = computeIsRequired(name, targets, options)));
  return answer;
}
