const paths = {
  play: 'm9 5 11 7-11 7Z',
  stop: 'M6 6h12v12H6Z',
  image: 'M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M15 8h.01',
  rotate: 'M4 10a8 8 0 1 1 2 8M4 4v6h6',
  measure: 'm4 16 12-12 4 4L8 20ZM9 11l3 3m1-7 3 3',
  photo: 'M3 7h5l2-3h4l2 3h5v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  video: 'M3 6h12v12H3Zm12 4 6-3v10l-6-3',
  gallery: 'M7 3h14v14H7ZM3 7v14h14M10 13l3-3 5 5',
  open: 'M3 7V5h6l2 2h10v12H3Zm0 0h18',
  record: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  pause: 'M8 5v14M16 5v14',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
