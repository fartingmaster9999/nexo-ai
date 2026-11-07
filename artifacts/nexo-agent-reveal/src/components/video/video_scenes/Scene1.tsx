import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.2, 0.85, 0.25, 1] as const;

export function Scene1({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [copyVisible, setCopyVisible] = useState(true);
  useSceneTimer([{ time: 1500, callback: () => setCopyVisible(false) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#020711]"
      initial={{ opacity: 0, scale: 1.045 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.12 }}
      transition={{ duration: 0.26, ease: EASE }}
    >
      <motion.video
        src={`${import.meta.env.BASE_URL}video/nexo-agent-mode.mp4`}
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 1.12, opacity: 0.82 }}
        animate={{ scale: [1.12, 1, 1.06, 1.34], opacity: [0.82, 1, 1, 0.96] }}
        transition={{ duration: 3.95, times: [0, 0.15, 0.58, 1], ease: EASE }}
        autoPlay
        muted
        playsInline
        preload="auto"
      />

      <motion.div
        className="absolute left-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '-104%' }}
        transition={{ delay: 0.02, duration: 0.34, ease: EASE }}
      />
      <motion.div
        className="absolute right-0 top-0 z-20 h-full w-[38%] bg-[#020711]"
        initial={{ x: 0 }}
        animate={{ x: '104%' }}
        transition={{ delay: 0.02, duration: 0.34, ease: EASE }}
      />
      <motion.h1
        className="nexo-display absolute left-[6%] top-[8%] z-40 m-0 max-w-[54%] text-[8.3vmin] leading-[0.96] text-[#f5f8ff]"
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={copyVisible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -12, scale: 0.99 }}
        transition={{ delay: copyVisible ? 0.12 : 0, duration: copyVisible ? 0.35 : 0.24, ease: EASE }}
      >
        Give it the <span className="text-[#70b5ff]">goal.</span>
      </motion.h1>
    </motion.section>
  );
}
