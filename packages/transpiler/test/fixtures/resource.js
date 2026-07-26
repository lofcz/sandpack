export function readAll(open) {
  using handle = open();
  return handle.readToEnd();
}
