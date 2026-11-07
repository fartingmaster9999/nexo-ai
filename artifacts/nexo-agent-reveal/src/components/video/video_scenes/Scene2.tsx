import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.18, 0.88, 0.24, 1] as const;

export function Scene2({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [close, setClose] = useState(false);
  useSceneTimer([{ time: 2200, callback: () => setClose(true) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 3.18, y: '15%', opacity: 0.04 }}
        animate={{
          scale: [3.18, 3.0, 3.25, 3.0, 3.28, 3.02, 3.18, 3.3],
          opacity: [0.04, 1, 0.035, 0.96, 0.04, 1, 0.22, 0.025],
        }}
        transition={{
          duration: 2.9,
          times: [0, 0.07, 0.08, 0.31, 0.39, 0.4, 0.61, 1],
          ease: EASE,
        }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: close ? 1 : 0 }}
        transition={{ duration: close ? 0.8 : 0.16, ease: EASE }}
        style={{ transformOrigin: 'left center' }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[48%] bg-[#020711]"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: close ? 1 : 0 }}
        transition={{ duration: close ? 0.8 : 0.16, ease: EASE }}
        style={{ transformOrigin: 'right center' }}
      />
    </motion.section>
  );
}
