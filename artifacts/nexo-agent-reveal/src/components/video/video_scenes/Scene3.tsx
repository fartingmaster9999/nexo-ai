import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene3({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [close, setClose] = useState(false);
  useSceneTimer([{ time: 4400, callback: () => setClose(true) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.46, ease: EASE }}
    >
      <motion.img
        src={`${import.meta.env.BASE_URL}images/nexo-agent-splash.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 3.2, y: '15%', opacity: 0.72 }}
        animate={{ scale: [3.2, 2.8, 2.7, 2.85], y: ['15%', '15%', '15%', '15%'], opacity: [0.72, 1, 1, 0.9] }}
        transition={{ duration: 5.9, times: [0, 0.2, 0.7, 1], ease: EASE }}
        style={{ transformOrigin: '50% 35%' }}
        draggable={false}
      />
      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: close ? 1 : 0 }}
        transition={{ duration: close ? 0.72 : 0.9, ease: EASE }}
        style={{ transformOrigin: 'left center' }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-1/2 bg-[#020711]"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: close ? 1 : 0 }}
        transition={{ duration: close ? 0.72 : 0.9, ease: EASE }}
        style={{ transformOrigin: 'right center' }}
      />
      <motion.div
        className="absolute left-1/2 top-0 z-30 h-full w-[0.22vmin] -translate-x-1/2"
        initial={{ opacity: 0.2, scaleY: 0.24 }}
        animate={{ opacity: close ? 0.95 : [0.2, 0.6, 0.12], scaleY: close ? 1 : [0.24, 0.8, 0.35] }}
        transition={{ duration: close ? 0.34 : 2.4, ease: EASE }}
        style={{ background: '#77b9ff', boxShadow: '0 0 2vmin #1769ff' }}
      />
    </motion.section>
  );
}
