"use client";

import { useEffect, useState } from "react";
import { MASCOT_PREF_EVENT, readMascotEnabled, writeMascotEnabled } from "./mascotPref";

/** 设置页里的桌宠开关。关了之后公开页不再挂载桌宠。 */
export function MascotPrefToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    setOn(readMascotEnabled());
    const sync = () => setOn(readMascotEnabled());
    window.addEventListener(MASCOT_PREF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MASCOT_PREF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <label className="checkbox-field">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => {
          const next = event.target.checked;
          setOn(next);
          writeMascotEnabled(next);
        }}
      />
      <span>显示小店桌宠</span>
    </label>
  );
}
