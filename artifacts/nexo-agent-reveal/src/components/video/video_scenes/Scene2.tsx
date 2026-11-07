import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene2({ sceneIndex: _sceneIndex }: { sceneIndex: number }) {
  const [secondLine, setSecondLine] = useState(false);
  useSceneTimer([{ time: 3150, callback: () => setSecondLine(true) }]);

  return (
    <motion.section
      className="absolute inset-0 overflow-hidden bg-[#030812]"
      initial={{ opacity: 0, scale: 1.08, x: '2%' }}
      animate={{ opacity: 1, scale: 1, x: '0%' }}
      exit={{ opacity: 0, scale: 1.12, x: '2%' }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_54%_47%,rgba(14,82,190,.25),transparent_58%)]" />
      <motion.div
        className="absolute left-[7%] top-[8%] h-[84%] w-[86%] border border-[#2784ff]/65"
        initial={{ scale: 1.035, opacity: 0.5 }}
        animate={{ scale: [1.035, 1, 1.015, 1], opacity: [0.5, 1, 0.72, 1] }}
        transition={{ duration: 5.7, times: [0, 0.2, 0.53, 1], ease: EASE }}
        style={{ boxShadow: '0 0 4vmin rgba(20,99,255,.22)' }}
      />
      <div className="absolute left-[7%] top-[8%] h-[0.55vmin] w-[13%] bg-[#4d9cff]" />
      <div className="absolute bottom-[8%] right-[7%] h-[0.55vmin] w-[13%] bg-[#4d9cff]" />

      <motion.div
        className="absolute left-[11%] top-[14%] h-[72%] w-[78%] overflow-hidden bg-[#07101f]"
        initial={{ scale: 1.09, opacity: 0.75 }}
        animate={{ scale: [1.09, 1, 1.08, 1], opacity: 1 }}
        transition={{ duration: 5.85, times: [0, 0.22, 0.5, 1], ease: EASE }}
      >
        <video
          src={`${import.meta.env.BASE_URL}video/nexo-agent-mode.mp4`}
          className="h-full w-full object-contain"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      </motion.div>

      <motion.div
        className="absolute left-[7%] top-[12%] z-10 text-[1.85vmin] text-[#b1c3de] nexo-mono"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 5.7, times: [0, 0.12, 0.82, 1] }}
      >
        AGENT MODE <span className="text-[#57a7ff]">/ ACTIVE</span>
      </motion.div>

      {!secondLine ? (
        <motion.h2
          className="nexo-display absolute left-[7%] bottom-[12%] z-20 m-0 text-[7.3vmin] leading-none text-[#f4f7ff]"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.55, ease: EASE }}
        >
          Give it the <span className="text-[#69afff]">goal.</span>
        </motion.h2>
      ) : (
        <motion.h2
          className="nexo-display absolute right-[7%] bottom-[12%] z-20 m-0 text-[7.3vmin] leading-none text-[#f4f7ff]"
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.48, ease: EASE }}
        >
          Watch it <span className="text-[#69afff]">move.</span>
        </motion.h2>
      )}
    </motion.section>
  );
}
