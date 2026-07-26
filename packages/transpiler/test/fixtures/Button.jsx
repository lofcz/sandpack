export function Button({ label, onClick }) {
  return (
    <button type="button" className="btn" onClick={onClick}>
      {label}
    </button>
  );
}

export default Button;
