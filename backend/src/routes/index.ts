import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth';
import { competitionRouter } from './competitions';
import { adminRouter } from './admin';
import { registrationsRouter } from './registrations';
import { teamRouter } from './team';

export const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/competitions', competitionRouter);
router.use('/admin', adminRouter);
router.use('/registrations', registrationsRouter);
router.use('/team', teamRouter);
