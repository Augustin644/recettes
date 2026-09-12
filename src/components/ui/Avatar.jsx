import { initials } from "../../lib/utils";

export default function Avatar({ name, url, size = 40, style, className = "" }) {
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.45, ...style }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}