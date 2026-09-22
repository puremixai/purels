import type { SVGProps } from "react";

export type IconName = "grid" | "link" | "chart" | "shield" | "logout" | "plus" | "search" | "external" | "trash" | "arrow" | "check" | "info" | "menu" | "close" | "lock" | "refresh" | "list" | "user" | "key" | "pulse" | "sun" | "moon" | "settings" | "globe" | "chevronUp" | "chevronDown" | "eye" | "eyeOff";

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.14 1.14" /><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 7 20l1.14-1.14" /></>,
  chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 3-4 3 2 5-7" /></>,
  shield: <><path d="M12 3 20 6v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  external: <><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="m6 7 1 14h10l1-14" /><path d="M9 7V4h6v3" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.5-3L4 10" /><path d="M4 5v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.5 3L20 14" /><path d="M20 19v-5h-5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2" /><path d="m17 6 2 2" /><path d="m14 9 2 2" /></>,
  pulse: <><path d="M3 12h4l2.5-6 4 12 2.5-6h5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
  moon: <path d="M20.8 15.2A8.5 8.5 0 0 1 8.8 3.2 8.5 8.5 0 1 0 20.8 15.2Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.41 1.41-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-2v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.41-1.41.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.41-1.41.06.06A1.7 1.7 0 0 0 12.35 8a1.7 1.7 0 0 0 1.03-1.56V5h2v1.44A1.7 1.7 0 0 0 16.4 8c.68.28 1.46.13 1.99-.4l.06-.06 1.41 1.41-.06.06A1.7 1.7 0 0 0 19.46 11c.28.68.94 1.13 1.67 1.13H22v2h-.87A1.7 1.7 0 0 0 19.4 15Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.4 3.1" /><path d="M6.3 7.5A15.9 15.9 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.7-.76" /><path d="m3 3 18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width={size} {...props}>
      {paths[name]}
    </svg>
  );
}
