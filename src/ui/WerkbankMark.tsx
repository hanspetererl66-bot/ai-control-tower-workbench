import { useId } from 'react';

export default function WerkbankMark({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const gradientId = `${useId().replace(/:/g, '')}-werkbank-mark`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="5" x2="37" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <path d="M22 4 38 20 22 40 6 20z" fill={`url(#${gradientId})`} />
      <path d="M22 4 30 20l-8 20-8-20z" fill="#fff" opacity=".22" />
    </svg>
  );
}
