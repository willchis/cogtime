import { useMemo } from 'react';
import { colormap, DATA_MIN, DATA_MAX } from '../lib/cogProtocol';

const STEPS = 64;

export default function Legend() {
  const gradient = useMemo(() => {
    const stops = [];
    for (let i = 0; i < STEPS; i++) {
      const t = i / (STEPS - 1);
      const [r, g, b] = colormap(t);
      stops.push(`rgb(${r},${g},${b})`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, []);

  return (
    <div className="legend">
      <div className="legend-title">Channel Classification (VV)</div>
      <div className="legend-bar" style={{ background: gradient }} />
      <div className="legend-labels">
        <span>{DATA_MIN}</span>
        <span>{((DATA_MIN + DATA_MAX) / 2).toFixed(1)}</span>
        <span>{DATA_MAX}</span>
      </div>
    </div>
  );
}
