import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { competitionRouter } from './competitions';
import { adminRouter } from './admin';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/competitions', competitionRouter);
router.use('/admin', adminRouter);
