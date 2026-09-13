import type { CSSProperties, ReactNode } from 'react';

const particles = Array.from({ length: 20 }, (_, index) => index);

export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="page-transition">
    <div className="transition-particles" aria-hidden="true">{particles.map((particle) => <i key={particle} style={{ '--particle': particle } as CSSProperties} />)}</div>
    <div className="page-transition-content">{children}</div>
  </div>;
}
