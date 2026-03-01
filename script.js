const video = document.getElementById('video');
const startBtn = document.getElementById('startBtn');
const exportBtn = document.getElementById('exportBtn');
const statusText = document.getElementById('status');
const classNameInput = document.getElementById('className');
const classDateInput = document.getElementById('classDate');
const scanOverlay = document.getElementById('scanOverlay');
const recentList = document.getElementById('recentList');

// Important: List the exact names of the images in your 'asset' folder (without .jpg)
const studentNames = ['Mudit', 'Sonam', 'Rohan'];
let faceMatcher;
let attendanceRecord = new Set();
let attendanceData = [];
let recognitionInterval;

// Step 1: Load the AI Models
Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('./models')
]).then(initApp).catch(err => {
    console.error("Failed to load models:", err);
    updateStatus("Error loading models.", "error");
});

function updateStatus(msg, state) {
    statusText.innerText = msg;
    statusText.className = 'status-badge';
    if (state === "ready") {
        statusText.classList.add('status-ready');
    } else if (state === "active") {
        statusText.classList.add('status-active');
    } else if (state === "error") {
        statusText.classList.add('status-error');
    }
}

async function initApp() {
    updateStatus("Preparing face database...", "");

    // Step 2: Create reference profiles from the 'asset' folder
    faceMatcher = await createFaceMatcher();

    if (!faceMatcher) {
        updateStatus("Failed: Missing assets (*.jpg)", "error");
        return;
    }

    updateStatus("System Ready", "ready");
    startBtn.disabled = false;
    startBtn.innerText = "START RECOGNITION";
}

async function createFaceMatcher() {
    const labeledDescriptors = await Promise.all(
        studentNames.map(async label => {
            try {
                // Fetch image from the asset folder
                const imgUrl = `./asset/${label}.jpg`;
                const img = await faceapi.fetchImage(imgUrl);

                // Detect face and compute descriptor
                const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

                if (!detections) {
                    console.error(`No face detected for ${label} in asset folder.`);
                    return null;
                }
                return new faceapi.LabeledFaceDescriptors(label, [detections.descriptor]);
            } catch (error) {
                console.error(`Failed to load or process image for ${label}:`, error);
                return null;
            }
        })
    );

    // Remove any nulls if an image failed
    const validDescriptors = labeledDescriptors.filter(desc => desc !== null);

    if (validDescriptors.length === 0) {
        return null;
    }
    // Set distance threshold to 0.65 -> This is looser (default is 0.5) 
    // This allows identifying standard faces even with slight angle changes / little probability variations
    return new faceapi.FaceMatcher(validDescriptors, 0.65);
}

// Step 3: Start Webcam
startBtn.addEventListener('click', () => {
    if (!classNameInput.value || !classDateInput.value) {
        alert("Please enter both Class Name and Date to proceed.");
        classNameInput.focus();
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
            startBtn.style.display = 'none';
            exportBtn.style.display = 'flex';
            scanOverlay.style.display = 'block'; // UI scan animation
            updateStatus("Scanning for faces...", "active");
        })
        .catch(err => {
            console.error(err);
            updateStatus("Camera access denied!", "error");
        });
});

// Step 4: Run Recognition on Video Play
video.addEventListener('play', () => {
    const canvas = faceapi.createCanvasFromMedia(video);
    document.getElementById('video-container').append(canvas);

    // We get actual rendered size for scaling
    const container = document.getElementById('video-container');

    const displaySize = {
        width: video.clientWidth || video.width,
        height: video.clientHeight || video.height
    };

    // Resize canvase dynamically to match the element's actual rendered size
    faceapi.matchDimensions(canvas, displaySize);

    recognitionInterval = setInterval(async () => {

        const videoRatio = video.videoWidth / video.videoHeight;
        const displaySizeDynamic = { width: video.clientWidth, height: video.clientWidth / videoRatio };

        if (canvas.width !== displaySizeDynamic.width || canvas.height !== displaySizeDynamic.height) {
            faceapi.matchDimensions(canvas, displaySizeDynamic);
        }

        const detections = await faceapi.detectAllFaces(video)
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySizeDynamic);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;

            // Adjust box manually because camera is mirrored (scaleX(-1) in CSS)
            const mirroredBox = new faceapi.Rect(
                canvas.width - box.x - box.width,
                box.y,
                box.width,
                box.height
            );

            const isUnknown = result.label === 'unknown';

            // Modern UI Draw Box Customization
            const drawOptions = {
                label: isUnknown ? "Unregistered" : `${result.label} (${Math.round((1 - result.distance) * 100)}%)`,
                lineWidth: 3,
                boxColor: isUnknown ? '#ef4444' : '#10b981', // Red for unknown, Green for known
                drawLabelOptions: {
                    fontSize: 20,
                    fontColor: '#ffffff',
                    backgroundColor: isUnknown ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)',
                    padding: 8
                }
            };

            const drawBox = new faceapi.draw.DrawBox(mirroredBox, drawOptions);
            drawBox.draw(canvas);

            // Mark Attendance if matched and not already marked
            const name = result.label;
            if (!isUnknown && !attendanceRecord.has(name)) {
                attendanceRecord.add(name);
                const timeStr = new Date().toLocaleTimeString();
                attendanceData.push({ Name: name, Time: timeStr, Status: "Present" });

                // Add to recent list UI
                addLogItem(name, timeStr);
            }
        });
    }, 300); // Scans slightly faster for a more modern reactive UI
});

function addLogItem(name, timeStr) {
    if (attendanceRecord.size === 1) {
        recentList.innerHTML = ''; // clear placeholder
    }

    const div = document.createElement('div');
    div.className = 'attendance-item';
    div.innerHTML = `
        <span class="att-name">${name}</span>
        <span class="att-time">${timeStr}</span>
    `;
    // Add to top
    recentList.insertBefore(div, recentList.firstChild);
}

// Step 5: Stop Camera and Export to Excel
exportBtn.addEventListener('click', () => {
    clearInterval(recognitionInterval);

    // Stop the video stream
    const stream = video.srcObject;
    if (stream) {
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }

    scanOverlay.style.display = 'none';

    if (attendanceData.length === 0) {
        alert("Session ended. No students were recognized.");
        updateStatus("Session Ended (No Data)", "ready");
        return;
    }

    // Generate Excel file using SheetJS
    const worksheet = XLSX.utils.json_to_sheet(attendanceData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");

    const className = classNameInput.value.replace(/\s+/g, '_');
    const classDate = classDateInput.value;
    const fileName = `Attendance_${className}_${classDate}.xlsx`;

    XLSX.writeFile(workbook, fileName);

    updateStatus(`Excel Exported: ${fileName}`, "ready");
    exportBtn.style.display = 'none';
    startBtn.style.display = 'flex';
    startBtn.innerText = "START NEW SESSION";
    startBtn.disabled = false;
});