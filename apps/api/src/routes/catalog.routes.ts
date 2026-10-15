import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticate } from '../middleware/authenticate.js';
import * as ctrl from '../controllers/session.controller.js';

export const catalogRouter = Router();

catalogRouter.use(authenticate);
catalogRouter.get('/products', asyncHandler(ctrl.products));
catalogRouter.get('/stores/:id/stock', asyncHandler(ctrl.storeStock));
