export function BMark({ variant = 'color', className = '' }: { variant?: 'color' | 'mono'; className?: string }) {
  const outer = variant === 'color' ? '#E7B84F' : '#F5F5F5';
  const inner = variant === 'color' ? '#075E45' : '#080808';
  const slot = 'M116 12h24l-3 27h-18z';
  return <svg className={`b-mark ${className}`} viewBox="0 0 256 256" fill="none" shapeRendering="geometricPrecision" aria-hidden="true">
    <circle cx="128" cy="128" r="118" fill={outer} />
    <g fill={inner}>
      <path d={slot}/><path d={slot} transform="rotate(30 128 128)"/><path d={slot} transform="rotate(60 128 128)"/><path d={slot} transform="rotate(90 128 128)"/><path d={slot} transform="rotate(120 128 128)"/><path d={slot} transform="rotate(150 128 128)"/>
      <path d={slot} transform="rotate(180 128 128)"/><path d={slot} transform="rotate(210 128 128)"/><path d={slot} transform="rotate(240 128 128)"/><path d={slot} transform="rotate(270 128 128)"/><path d={slot} transform="rotate(300 128 128)"/><path d={slot} transform="rotate(330 128 128)"/>
    </g>
    <circle cx="128" cy="128" r="87" fill={inner} stroke={outer} strokeWidth="5" />
    <g fill={outer} transform="translate(128 128) scale(.9) translate(-132.739 -141.717)">
      <path d="M103 55h10v18h-10zM123 55h10v18h-10zM103 207h10v18h-10zM123 207h10v18h-10z" />
      <path fillRule="evenodd" d="M82 72h54c30 0 48 15 48 38 0 14-8 25-23 31 18 5 29 17 29 34 0 24-20 37-53 37H82v-18h12V90H82V72Zm34 18v39h20c17 0 26-7 26-20s-9-19-26-19h-20Zm0 58v46h22c19 0 29-8 29-23s-10-23-29-23h-22Z" />
    </g>
  </svg>;
}
