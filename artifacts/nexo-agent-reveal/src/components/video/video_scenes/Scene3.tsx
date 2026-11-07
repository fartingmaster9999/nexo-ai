import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [completed, setCompleted] = useState(false);
  useSceneTimer([{ time: 2620, callback: () => setCompleted(true) }]);
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#030812]"
      initial={{ opacity: 0, scale: 1.055 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.11 }}
      transition={{ duration: 0.62, ease: EASE }}
    >
      <motion.div
        className="absolute inset-y-0 right-0 bg-[#091b38]"
        initial={{ width: '58%' }}
        animate={{ width: ['58%', '58%', '42%', '42%'] }}
        transition={{ duration: 5.9, times: [0, 0.42, 0.56, 1], ease: EASE }}
      />
      <div className="absolute left-[5.5%] top-[11%] text-[1.9vmin] text-[#92a8cb] nexo-mono">
        NEXO AGENT <span className="text-[#57a7ff]">/</span> INTENT → ACTION
      </div>

      <motion.div
        className="absolute left-[5%] top-[34%] z-10 w-[54%]"
        key={completed ? 'done' : 'start'}
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.46, ease: EASE }}
      >
        {completed ? (
          <div className="nexo-display text-[19vmin] leading-[0.88] tracking-[-0.08em] text-[#f4f7ff]">
            <div>TO</div>
            <div className="text-[15vmin]">
              PROGRESS<span className="text-[#59a7ff]">.</span>
            </div>
          </div>
        ) : (
          <div className="nexo-display text-[19vmin] leading-[0.88] tracking-[-0.08em] text-[#f4f7ff]">
            <div className="text-[16vmin]">FROM</div>
            <div>PROMPT</div>
          </div>
        )}
      </motion.div>

      <motion.div
        className="absolute left-[36%] top-1/2 z-20 h-[0.32vmin] origin-left bg-[#62adff]"
        initial={{ scaleX: 0, opacity: 0.35 }}
        animate={{ scaleX: [0, 1, 1, 1.55], opacity: [0.35, 1, 1, 0.1] }}
        transition={{ duration: 5.7, times: [0, 0.42, 0.82, 1], ease: EASE }}
        style={{ width: '47%' }}
      />
      <motion.div
        className="absolute left-[35%] top-1/2 z-30 h-[1.35vmin] w-[1.35vmin] -translate-y-1/2 rounded-full bg-[#9dd1ff]"
        initial={{ x: 0, scale: 0.75 }}
        animate={{ x: ['0%', '100%', '100%'], scale: [0.75, 1.15, 1] }}
        transition={{ duration: 5.65, times: [0, 0.52, 1], ease: EASE }}
        style={{ boxShadow: '0 0 2.5vmin #1769ff' }}
      />

      <motion.svg
        className="absolute right-[6%] top-[19%] h-[63%] w-[38%] overflow-visible"
        viewBox="0 0 500 500"
        fill="none"
        initial={{ opacity: 0.25, scale: 0.78, rotate: -22 }}
        animate={{ opacity: [0.25, 0.8, 1, 0.9], scale: [0.78, 0.9, 1, 1.28], rotate: [-22, 0, 10, 0] }}
        transition={{ duration: 5.9, times: [0, 0.36, 0.72, 1], ease: EASE }}
      >
        <motion.path
          d="M142 70 330 258Q352 280 330 302L190 442M358 92 170 280Q148 302 170 324L310 464"
          stroke="#3D91FF"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: [0, 0.45, 1, 1] }}
          transition={{ duration: 5.4, times: [0, 0.44, 0.77, 1], ease: 'easeInOut' }}
          style={{ filter: 'drop-shadow(0 0 14px rgba(28,113,255,.8))' }}
        />
      </motion.svg>
    </motion.section>
  );
}
