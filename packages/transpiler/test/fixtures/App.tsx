import { useState } from 'react';

interface Props {
  initial: number;
}

export default function App({ initial }: Props) {
  const [count, setCount] = useState(initial);
  return (
    <main className="app">
      <h1>count is {count}.</h1>
      <button onClick={() => setCount((c) => c + 1)}>increment</button>
    </main>
  );
}
