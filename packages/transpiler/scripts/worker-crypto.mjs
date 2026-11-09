// React Refresh only calls crypto.createHash. Avoid bundling Node's unrelated
// cipher, key-exchange and signing implementations into the browser compiler.
import createHash from 'create-hash';

export { createHash };
