const express = require("express");
const router = express.Router();
const { requireStayAccess } = require("../services/accessPolicy");
const { getColumns } = require("./schemaCapabilities");

const authMiddleware = require("../middleware/authMiddleware");
const {
  getPostErData,
  createDischarge,
  createFollowUp,
  getAssignedDoctor,
  assignDoctorToStay,
} = require("../services/postErService");

const {
  createPrescription,
  reviewPrescription,
  getPrescriptions,
} = require("../services/prescriptionService");

router.use(authMiddleware);

const requireErStaff = authMiddleware.requireRole("ER_STAFF", "ADMIN");
const requireAdmin = authMiddleware.requireRole("ADMIN");
const requireDoctor = authMiddleware.requireRole("DOCTOR");

function validateStayId(req, res, next) {
  const stayId = Number(req.params.stay_id);

  if (!Number.isSafeInteger(stayId) || stayId <= 0) {
    return res.status(400).json({ error: "Invalid stay_id" });
  }

  req.stayId = stayId;
  next();
}

// POST: Assign a doctor to an ER stay (ADMIN only)
router.post(
  "/:stay_id/assign-doctor",
  requireAdmin,
  validateStayId,
  async (req, res) => {
    try {
      const doctorUserId = Number(req.body?.doctor_user_id);

      if (!Number.isSafeInteger(doctorUserId) || doctorUserId <= 0) {
        return res.status(400).json({
          error: "A valid doctor_user_id is required",
        });
      }

      const notes =
        typeof req.body?.notes === "string"
          ? req.body.notes.trim()
          : null;

      if (notes && notes.length > 1000) {
        return res.status(400).json({
          error: "notes cannot exceed 1000 characters",
        });
      }

      const assignment = await assignDoctorToStay(
        req.stayId,
        doctorUserId,
        req.user.user_id,
        notes
      );

      return res.status(201).json({
        message: "Doctor assigned successfully",
        assignment,
      });
    } catch (error) {
      console.error("Doctor assignment error:", error.message);

      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Failed to assign doctor",
      });
    }
  }
);

// GET: Retrieve the active doctor assigned to an ER stay
router.get(
  "/:stay_id/assigned-doctor",
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const doctor = await getAssignedDoctor(req.stayId);

      return res.json({
        assigned_doctor: doctor,
      });
    } catch (error) {
      console.error("Assigned doctor fetch error:", error.message);

      return res.status(500).json({
        error: "Failed to fetch assigned doctor",
      });
    }
  }
);


// GET: Complete POST-ER view
router.get(
  "/:stay_id",
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const data = await getPostErData(req.stayId, { role: req.user.role });

      if (!data) {
        return res.status(404).json({ error: "ED stay not found" });
      }

      return res.json(data);
    } catch (error) {
      console.error("POST-ER fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch POST-ER data" });
    }
  }
);

// POST: Create discharge
router.post(
  "/:stay_id/discharge",
  requireDoctor,
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const {
        discharge_time,
        discharge_status,
        discharge_diagnosis,
        discharge_instructions,
        disposition,
        prescribed_followup,
      } = req.body || {};

      if (
        typeof discharge_status !== "string" ||
        !discharge_status.trim()
      ) {
        return res.status(400).json({
          error: "discharge_status is required",
        });
      }

      if (
        prescribed_followup !== undefined &&
        typeof prescribed_followup !== "boolean"
      ) {
        return res.status(400).json({
          error: "prescribed_followup must be true or false",
        });
      }

      if (
        discharge_time !== undefined &&
        (typeof discharge_time !== "string" ||
          Number.isNaN(Date.parse(discharge_time)))
      ) {
        return res.status(400).json({
          error: "discharge_time must be a valid date/time",
        });
      }

      const result = await createDischarge(req.stayId, {
  authorized_by: req.user.user_id,
  discharge_time,
  discharge_status: discharge_status.trim(),
  discharge_diagnosis,
  discharge_instructions,
  disposition,
  prescribed_followup,
});
      return res.status(201).json({
        message: "Discharge record created",
        discharge: result,
      });
    } catch (error) {
      console.error("POST-ER discharge error:", error.message);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to create discharge",
      });
    }
  }
);

// POST: Create follow-up
router.post(
  "/:stay_id/follow-ups",
  requireErStaff,
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const {
        follow_up_date,
        follow_up_type,
        department,
        provider_name,
        status,
        notes,
      } = req.body || {};

      if (
        typeof follow_up_date !== "string" ||
        Number.isNaN(Date.parse(follow_up_date))
      ) {
        return res.status(400).json({
          error: "A valid follow_up_date is required",
        });
      }

      if (
        typeof follow_up_type !== "string" ||
        !follow_up_type.trim()
      ) {
        return res.status(400).json({
          error: "follow_up_type is required",
        });
      }

      const result = await createFollowUp(req.stayId, {
        follow_up_date,
        follow_up_type: follow_up_type.trim(),
        department,
        provider_name,
        status,
        notes,
      });

      return res.status(201).json({
        message: "Follow-up created",
        follow_up: result,
      });
    } catch (error) {
      console.error("POST-ER follow-up error:", error.message);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to create follow-up",
      });
    }
  }
);

// POST: Create and screen a proposed prescription (assigned DOCTOR only)
router.post(
  "/:stay_id/prescriptions",
  requireDoctor,
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const {
        medication_name,
        dosage,
        frequency,
        route,
        duration,
        instructions,
      } = req.body || {};

      if (
        typeof medication_name !== "string" ||
        !medication_name.trim()
      ) {
        return res.status(400).json({
          error: "medication_name is required",
        });
      }

      const optionalFields = {
        dosage: 200,
        frequency: 200,
        route: 100,
        duration: 100,
        instructions: 2000,
      };

      for (const [field, maxLength] of Object.entries(optionalFields)) {
        if (
          req.body?.[field] !== undefined &&
          req.body[field] !== null &&
          (typeof req.body[field] !== "string" ||
            req.body[field].length > maxLength)
        ) {
          return res.status(400).json({
            error: `${field} must be a string of at most ${maxLength} characters`,
          });
        }
      }

      if (medication_name.trim().length > 200) {
        return res.status(400).json({
          error: "medication_name cannot exceed 200 characters",
        });
      }

      const result = await createPrescription(
        req.stayId,
        {
          medication_name: medication_name.trim(),
          dosage: dosage?.trim(),
          frequency: frequency?.trim(),
          route: route?.trim(),
          duration: duration?.trim(),
          instructions: instructions?.trim(),
        },
        req.user.user_id
      );

      return res.status(201).json({
        message: "Prescription created and screening completed",
        ...result,
      });
    } catch (error) {
      console.error("Prescription creation error:", error.message);

      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Failed to create prescription",
      });
    }
  }
);

// GET: Retrieve prescriptions for an ED stay
router.get(
  "/:stay_id/prescriptions",
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const prescriptions = await getPrescriptions(req.stayId, { role: req.user.role });

      return res.json({ prescriptions });
    } catch (error) {
      console.error("Prescription fetch error:", error.message);

      return res.status(500).json({
        error: "Failed to fetch prescriptions",
      });
    }
  }
);

// PATCH: Assigned DOCTOR authorizes or rejects a pending prescription
router.patch(
  "/:stay_id/prescriptions/:prescription_id/review",
  requireDoctor,
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const prescriptionId = Number(req.params.prescription_id);
      const { status, review_notes } = req.body || {};

      if (
        !Number.isSafeInteger(prescriptionId) ||
        prescriptionId <= 0
      ) {
        return res.status(400).json({
          error: "Invalid prescription_id",
        });
      }

      if (!["AUTHORIZED", "REJECTED"].includes(status)) {
        return res.status(400).json({
          error: "status must be AUTHORIZED or REJECTED",
        });
      }

      if (
        review_notes !== undefined &&
        review_notes !== null &&
        (typeof review_notes !== "string" ||
          review_notes.length > 2000)
      ) {
        return res.status(400).json({
          error: "review_notes must be a string of at most 2000 characters",
        });
      }

      const prescription = await reviewPrescription(
        req.stayId,
        prescriptionId,
        {
          status,
          review_notes: review_notes?.trim(),
        },
        req.user.user_id
      );

      return res.json({
        message: `Prescription ${status.toLowerCase()} successfully`,
        prescription,
      });
    } catch (error) {
      console.error("Prescription review error:", error.message);

      return res.status(error.statusCode || 500).json({
        error: error.statusCode
          ? error.message
          : "Failed to review prescription",
      });
    }
  }
);
// GET: Follow-ups for a stay
router.get(
  "/:stay_id/follow-ups",
  validateStayId,
  requireStayAccess("stay_id", { postEr: true }),
  async (req, res) => {
    try {
      const data = await getPostErData(req.stayId, { role: req.user.role });

      if (!data) {
        return res.status(404).json({ error: "ED stay not found" });
      }

      return res.json({ follow_ups: data.follow_ups });
    } catch (error) {
      console.error("POST-ER follow-up fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch follow-ups" });
    }
  }
);

module.exports = router;
