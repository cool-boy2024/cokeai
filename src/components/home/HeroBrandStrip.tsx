import { MOBILE_MARKS } from "./brandMarks";

export function HeroBrandStrip() {
  return (
    <div className="hero-brand-strip" aria-hidden="true">
      {MOBILE_MARKS.map((mark) => (
        <span className="hero-brand-chip" key={mark.name}>
          <img
            src={mark.file}
            alt=""
            width={20}
            height={20}
            draggable={false}
            decoding="async"
          />
          <span>{mark.name}</span>
        </span>
      ))}
    </div>
  );
}
