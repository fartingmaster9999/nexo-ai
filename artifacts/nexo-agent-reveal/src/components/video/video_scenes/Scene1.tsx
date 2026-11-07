import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [line, setLine] = useState(0);
  useSceneTimer([{ time: 1480, callback: () => setLine(1) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#030812]"
      initial={{ opacity: 0, scale: 1.035 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12, x: '-3%' }}
      transition={{ duration: 0.62, ease: EASE }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_54%,rgba(14,72,170,.18),transparent_42%)]" />
      <div className="absolute left-[7%] top-[13%] text-[1.8vmin] text-[#8da4c9] nexo-mono">
        NEXO <span className="text-[#4d9cff]">/</span> AGENT MODE
      </div>

      <motion.div
        className="absolute left-[60%] top-[52%] aspect-square w-[63vmin] rounded-full"
        initial={{ scale: 0.62, rotate: -12, opacity: 0.72 }}
        animate={{
          scale: [0.62, 1, 1.08, 1.2],
          rotate: [-12, 0, 8, 0],
          opacity: [0.72, 1, 1, 0.94],
        }}
        transition={{
          duration: 3.95,
          times: [0, 0.22, 0.62, 1],
          ease: EASE,
        }}
        style={{
          border: '1px solid rgba(65,151,255,.9)',
          boxShadow: '0 0 2.2vmin rgba(23,105,255,.52), inset 0 0 2.8vmin rgba(23,105,255,.12)',
          transformOrigin: '50% 50%',
        }}
      >
        <motion.div
          className="absolute inset-[10%] rounded-full border border-[#4b9cff]/35"
          animate={{ rotate: 360, scale: [1, 1.035, 1] }}
          transition={{ rotate: { duration: 18, repeat: Infinity, ease: 'linear' }, scale: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }}
        />
        <div className="absolute left-1/2 top-1/2 h-[1.2vmin] w-[1.2vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#72b8ff] shadow-[0_0_2.4vmin_#1769ff]" />
      </motion.div>

      <motion.div
        className="absolute left-[7%] top-[39%] z-10 w-[55%]"
        key={line}
        initial={{ opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.48, ease: EASE }}
      >
        {line === 0 ? (
          <h1 className="nexo-display m-0 text-[8.8vmin] leading-[0.97] text-[#f4f7ff]">
            A better way
          </h1>
        ) : (
          <h1 className="nexo-display m-0 max-w-[53vmin] text-[8.8vmin] leading-[0.97] text-[#f4f7ff]">
            to get things <span className="text-[#4d9cff]">done.</span>
          </h1>
        )}
      </motion.div>
      <motion.div
        className="absolute left-[7.2%] top-[59%] h-[0.45vmin] origin-left bg-[#1769ff]"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0.65] }}
        transition={{ duration: 3.5, times: [0, 0.2, 0.68, 1], ease: EASE }}
        style={{ width: '19vmin' }}
      />
      <motion.div
        className="absolute left-[7%] bottom-[14%] flex items-center gap-[1.2vmin] text-[1.9vmin] text-[#8498b7]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.5 }}
      >
        <span className="h-[0.55vmin] w-[0.55vmin] rounded-full bg-[#57a7ff]" />
        A new kind of momentum.
      </motion.div>
    </motion.section>
  );
}
