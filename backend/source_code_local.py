import os
import urllib.request
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

model_path = 'pose_landmarker.task'
if not os.path.exists(model_path):
    print("Downloading official MediaPipe Pose model bundle...")
    url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
    urllib.request.urlretrieve(url, model_path)
    print("Model downloaded successfully!")

patient_vector_db = {
    "patient_001_CP": {
        "name": "Ahmed",
        "condition": "Cerebral Palsy - Crouch Gait",
        "ideal_knee_angle": 170.0,
        "critical_threshold": 30.0,
        "minor_threshold": 15.0
    }
}

def calculate_angle(a, b, c):
    a = np.array(a)
    b = np.array(b)
    c = np.array(c)
    radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
    angle = np.abs(radians * 180.0 / np.pi)
    if angle > 180.0:
        angle = 360.0 - angle
    return angle

def retrieve_rag_context(patient_id):
    return patient_vector_db.get(patient_id, None)

def calculate_deviation_model(current_angle, clinical_context):
    ideal_angle = clinical_context["ideal_knee_angle"]
    return ideal_angle - current_angle

def policy_decision_engine(deviation, clinical_context):
    if deviation > clinical_context["critical_threshold"]:
        return "ALERT: High Fall Risk! Straighten legs!", (0, 0, 255)
    elif deviation > clinical_context["minor_threshold"]:
        return "Gentle correction: Try to push knees back.", (0, 165, 255)
    elif deviation < -10.0:
        return "Warning: Knee locked backward.", (0, 255, 255)
    else:
        return "Excellent walking posture! Keep going!", (0, 255, 0)

base_options = python.BaseOptions(model_asset_path=model_path)
options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
    min_pose_detection_confidence=0.25,
    min_tracking_confidence=0.25
)
detector = vision.PoseLandmarker.create_from_options(options)

POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (27, 29), (27, 31),
    (24, 26), (26, 28), (28, 30), (28, 32)
]

def draw_skeleton_direct(image, landmarks, w, h):
    points = {}
    for idx, lm in enumerate(landmarks):
        px, py = int(lm.x * w), int(lm.y * h)
        points[idx] = (px, py)
        cv2.circle(image, (px, py), 5, (0, 255, 0), -1)

    for start_idx, end_idx in POSE_CONNECTIONS:
        if start_idx in points and end_idx in points:
            cv2.line(image, points[start_idx], points[end_idx], (0, 255, 255), 2)

clinical_context = retrieve_rag_context("patient_001_CP")

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("ERROR: Could not open webcam (camera 0). Check your camera permissions.")
    exit(1)

print("Press ESC to exit.")
while True:
    ok, frame = cap.read()
    if not ok:
        break

    h, w, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

    detection_result = detector.detect(mp_image)

    feedback_text = "Stand back: searching for body pose..."
    feedback_color = (220, 220, 220)

    if detection_result.pose_landmarks:
        landmarks = detection_result.pose_landmarks[0]
        draw_skeleton_direct(frame, landmarks, w, h)

        hip = [landmarks[23].x, landmarks[23].y]
        knee = [landmarks[25].x, landmarks[25].y]
        ankle = [landmarks[27].x, landmarks[27].y]

        current_knee_angle = calculate_angle(hip, knee, ankle)
        knee_pixel = (int(knee[0] * w), int(knee[1] * h))

        cv2.putText(frame, f"{int(current_knee_angle)} deg", (knee_pixel[0] + 10, knee_pixel[1]),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2, cv2.LINE_AA)

        deviation = calculate_deviation_model(current_knee_angle, clinical_context)
        feedback_text, feedback_color = policy_decision_engine(deviation, clinical_context)

    cv2.rectangle(frame, (0, 0), (w, 40), (0, 0, 0), -1)
    cv2.putText(frame, feedback_text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, feedback_color, 2, cv2.LINE_AA)

    cv2.imshow("CP Posture Feedback", frame)
    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()