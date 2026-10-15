import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticate, authorize } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  createSessionSchema,
  idParam,
  itemsQuery,
  listSessionsQuery,
  rejectSchema,
  saveItemsSchema,
} from '../schemas/session.js';
import * as ctrl from '../controllers/session.controller.js';
import { CSV_MAX_BYTES } from '../config.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES },
});

export const sessionRouter = Router();

sessionRouter.use(authenticate);

sessionRouter.post(
  '/',
  authorize(Role.MANAGER),
  validate({ body: createSessionSchema }),
  asyncHandler(ctrl.createSession),
);

sessionRouter.get(
  '/',
  validate({ query: listSessionsQuery }),
  asyncHandler(ctrl.listSessions),
);

sessionRouter.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(ctrl.getSession),
);

sessionRouter.get(
  '/:id/items',
  validate({ params: idParam, query: itemsQuery }),
  asyncHandler(ctrl.listItems),
);

sessionRouter.put(
  '/:id/items',
  authorize(Role.STAFF),
  validate({ params: idParam, body: saveItemsSchema }),
  asyncHandler(ctrl.saveItems),
);

sessionRouter.post(
  '/:id/items/import',
  authorize(Role.STAFF),
  validate({ params: idParam }),
  upload.single('file'),
  asyncHandler(ctrl.importItems),
);

sessionRouter.post(
  '/:id/submit',
  authorize(Role.STAFF),
  validate({ params: idParam }),
  asyncHandler(ctrl.submit),
);

sessionRouter.post(
  '/:id/withdraw',
  authorize(Role.STAFF),
  validate({ params: idParam }),
  asyncHandler(ctrl.withdraw),
);

sessionRouter.post(
  '/:id/approve',
  authorize(Role.MANAGER),
  validate({ params: idParam }),
  asyncHandler(ctrl.approve),
);

sessionRouter.post(
  '/:id/reject',
  authorize(Role.MANAGER),
  validate({ params: idParam, body: rejectSchema }),
  asyncHandler(ctrl.reject),
);

sessionRouter.post(
  '/:id/retry-apply',
  authorize(Role.MANAGER),
  validate({ params: idParam }),
  asyncHandler(ctrl.retryApply),
);

sessionRouter.post(
  '/:id/cancel',
  authorize(Role.MANAGER),
  validate({ params: idParam }),
  asyncHandler(ctrl.cancel),
);

sessionRouter.get(
  '/:id/report.csv',
  authorize(Role.MANAGER),
  validate({ params: idParam }),
  asyncHandler(ctrl.report),
);

sessionRouter.get(
  '/:id/history',
  validate({ params: idParam }),
  asyncHandler(ctrl.history),
);
