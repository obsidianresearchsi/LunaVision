
import React, { useState, useRef, useEffect } from 'react';
import { supabaseDb } from '../services/supabaseDb';
import { FacePlusPlusService } from '../services/facepp';
import { uploadMugshot, deleteMugshot, StorageError } from '../services/supabaseStorage';
import { compressImage } from '../utils/imageCompression';
import { Suspect } from '../types';
import { Upload, FileText, Shield, Save, CheckCircle, AlertCircle, Camera, Loader2, Circle, X, Settings, MapPin, Edit } from 'lucide-react';

// Pre-defined coordinates for major Nigerian cities to enable Auto-Geocoding
const CITY_COORDINATES: Record<string, { lat: number, lng: number }> = {
    'lagos': { lat: 6.5244, lng: 3.3792 },
    'ikeja': { lat: 6.6018, lng: 3.3515 },
    'abuja': { lat: 9.0765, lng: 7.3986 },
    'fct': { lat: 9.0765, lng: 7.3986 },
    'port harcourt': { lat: 4.8156, lng: 7.0498 },
    'phc': { lat: 4.8156, lng: 7.0498 },
    'kano': { lat: 12.0022, lng: 8.5920 },
    'ibadan': { lat: 7.3775, lng: 3.9470 },
    'kaduna': { lat: 10.5105, lng: 7.4165 },
    'benin': { lat: 6.3350, lng: 5.6037 },
    'benin city': { lat: 6.3350, lng: 5.6037 },
    'enugu': { lat: 6.4584, lng: 7.5464 },
    'jos': { lat: 9.8965, lng: 8.8583 },
    'ilorin': { lat: 8.4799, lng: 4.5418 },
    'maiduguri': { lat: 11.8311, lng: 13.1510 },
    'warri': { lat: 5.5544, lng: 5.7932 },
    'onitsha': { lat: 6.1429, lng: 6.7850 },
    'calabar': { lat: 4.9545, lng: 8.3250 },
    'owerri': { lat: 5.4832, lng: 7.0335 }
};



interface EnrollmentProps {
    initialData?: Suspect | null;
}

export const Enrollment: React.FC<EnrollmentProps> = ({ initialData }) => {
    const [mode, setMode] = useState<'SIMPLE' | 'ADVANCED'>('SIMPLE');
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeStep, setActiveStep] = useState(0); 
    const [status, setStatus] = useState<{type: 'success' | 'error', msg: string} | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Suspect> & { lat?: string, lng?: string }>({
        name: '',
        crime: '',
        location: '',
        nin: '',
        status: 'WANTED',
        gender: 'MALE',
        dob: '',
        physicalMarks: '',
        notes: '',
        lat: '',
        lng: ''
    });

    const isEditMode = !!initialData;

    useEffect(() => {
        if (initialData) {
            setMode('ADVANCED'); // Default to advanced for editing
            setFormData({
                name: initialData.name,
                crime: initialData.crime,
                location: initialData.location,
                nin: initialData.nin,
                status: initialData.status || 'WANTED',
                gender: initialData.gender || 'MALE',
                dob: initialData.dob || '',
                physicalMarks: initialData.physicalMarks || '',
                notes: initialData.notes || '',
                lat: initialData.coordinates?.lat.toString() || '',
                lng: initialData.coordinates?.lng.toString() || ''
            });
            setPreviewUrl(initialData.imageUrl);
        }
    }, [initialData]);

    const steps = [
        { id: 1, label: "High-Res Biometric Encoding (Face++)" },
        { id: 2, label: "Indexing Identity Vector to Cloud" },
        { id: 3, label: "Generating UI Thumbnail & Encrypting" }
    ];

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            
            const reader = new FileReader();
            reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null);
        setPreviewUrl('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validation
        if (!isEditMode && !imageFile) {
            setStatus({ type: 'error', msg: 'Reference photograph required for facial encoding.' });
            return;
        }
        if (!formData.name || !formData.crime) {
            setStatus({ type: 'error', msg: 'Name and Crime are mandatory fields.' });
            return;
        }

        setIsProcessing(true);
        setStatus(null);
        setActiveStep(1); // Start Detect

        try {
            let token = initialData?.faceToken || '';
            let finalImageUrl = previewUrl;

            // Only process image if a new one is selected
            if (imageFile) {
                // Delete old image from storage if updating existing suspect
                // _Requirements: 3.1, 3.2, 3.3_
                if (isEditMode && initialData?.faceToken) {
                    await deleteMugshot(initialData.faceToken);
                }

                // 1. Send ORIGINAL High-Res File to Face++ to get Token
                // This ensures maximum recognition accuracy.
                token = await FacePlusPlusService.detectFace(imageFile);
                
                // 2. Add Token to FaceSet
                setActiveStep(2); // Start Index
                await FacePlusPlusService.addFaceToFaceset(token);

                // 3. Compress image and upload to Supabase Storage
                // This saves storage space but doesn't affect the AI model.
                setActiveStep(3); // Start Save
                const compressedBlob = await compressImage(imageFile);
                finalImageUrl = await uploadMugshot(token, compressedBlob);
            } else if (isEditMode) {
                // Skip detect/index if no new image in edit mode
                setActiveStep(2);
                await new Promise(r => setTimeout(r, 300));
            }

            // 4. Save to Local DB (step 3 already set if image was processed)
            if (!imageFile) {
                setActiveStep(3); // Start Save only if not already set
            }
            
            await new Promise(r => setTimeout(r, 600));

            // Parse coordinates if provided manually
            let coordinates = initialData?.coordinates;
            
            if (formData.lat && formData.lng) {
                const lat = parseFloat(formData.lat);
                const lng = parseFloat(formData.lng);
                if (!isNaN(lat) && !isNaN(lng)) {
                    coordinates = { lat, lng };
                }
            } else if (!coordinates && formData.location) {
                // Auto-Geocode: Check if location matches a known city
                const locLower = formData.location.toLowerCase().trim();
                const matchedCity = Object.keys(CITY_COORDINATES).find(city => locLower.includes(city));
                
                if (matchedCity) {
                    coordinates = CITY_COORDINATES[matchedCity];
                }
            }

            const suspectPayload: Suspect = {
                faceToken: token,
                name: formData.name!,
                crime: formData.crime!,
                location: formData.location || 'Unknown',
                nin: formData.nin || 'UNREGISTERED',
                imageUrl: finalImageUrl,
                sourceUrl: initialData?.sourceUrl || 'Manual Enrollment',
                status: formData.status as any,
                dob: formData.dob,
                gender: formData.gender as any,
                physicalMarks: formData.physicalMarks,
                notes: formData.notes,
                coordinates: coordinates
            };

            if (isEditMode) {
                await supabaseDb.updateSuspect(suspectPayload);
                setStatus({ type: 'success', msg: `Identity '${suspectPayload.name}' updated successfully.` });
            } else {
                await supabaseDb.addSuspect(suspectPayload);
                const locMsg = coordinates ? ` and plotted at [${coordinates.lat}, ${coordinates.lng}]` : '';
                setStatus({ type: 'success', msg: `Identity '${suspectPayload.name}' indexed${locMsg}.` });
                
                // Reset form only on create
                setFormData({
                    name: '', crime: '', location: '', nin: '',
                    status: 'WANTED', gender: 'MALE', dob: '', physicalMarks: '', notes: '',
                    lat: '', lng: ''
                });
                setImageFile(null);
                setPreviewUrl('');
            }
            
            setActiveStep(4); // Done
            
            setTimeout(() => {
                setIsProcessing(false);
                setActiveStep(0);
            }, 3000);

        } catch (err: any) {
            // Handle storage upload failures specifically
            // _Requirements: 2.4_
            if (err instanceof StorageError) {
                setStatus({ 
                    type: 'error', 
                    msg: `Image upload failed: ${err.message}${err.details ? ` (${err.details})` : ''}` 
                });
            } else {
                setStatus({ type: 'error', msg: err.message || 'Operation failed.' });
            }
            setIsProcessing(false);
            setActiveStep(0);
        }
    };

    return (
        <div className="max-w-5xl mx-auto h-full flex flex-col">
            <header className="lunar-page-heading lunar-investigation-heading mb-6">
                <div>
                    <h1>{isEditMode ? 'Edit subject record' : 'Subject enrollment'}</h1>
                    <p className="text-slate-400">
                        {isEditMode ? 'Update suspect details and status.' : 'Register new subjects into the facial recognition database.'}
                    </p>
                </div>
                
                <div className="flex bg-eagle-800 rounded-lg p-1 border border-eagle-700">
                    <button 
                        onClick={() => setMode('SIMPLE')}
                        className={`px-4 py-2 rounded text-sm font-bold transition-all ${mode === 'SIMPLE' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        Simple Form
                    </button>
                    <button 
                        onClick={() => setMode('ADVANCED')}
                        className={`px-4 py-2 rounded text-sm font-bold transition-all ${mode === 'ADVANCED' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        Advanced Detail
                    </button>
                </div>
            </header>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Image Upload */}
                <div className="lg:col-span-1">
                    <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-6">
                        <h3 className="text-sm font-bold text-slate-300 mb-4 uppercase tracking-wider flex items-center">
                            <Camera size={16} className="mr-2" /> Biometric Data
                        </h3>
                        
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full aspect-square border-2 border-dashed border-eagle-600 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-eagle-900/50 hover:border-blue-500 transition-all relative overflow-hidden group"
                        >
                            {previewUrl ? (
                                <>
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                                    {/* Overlay for Change interaction */}
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <p className="text-white font-bold text-sm flex items-center">
                                            <Upload size={14} className="mr-2" />
                                            Click to Change
                                        </p>
                                    </div>
                                    {/* Explicit Remove Button */}
                                    <button 
                                        onClick={handleRemoveImage}
                                        className="absolute top-2 right-2 p-2 bg-red-600/90 hover:bg-red-500 text-white rounded-full transition-colors shadow-lg z-10"
                                        title="Remove Image"
                                    >
                                        <X size={16} />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="p-4 bg-eagle-900 rounded-full mb-2">
                                        <Upload className="w-8 h-8 text-slate-400" />
                                    </div>
                                    <p className="text-sm text-slate-400 font-medium">Upload Mugshot</p>
                                    <p className="text-xs text-slate-500 mt-1">.JPG, .PNG max 5MB</p>
                                </>
                            )}
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileSelect} 
                                className="hidden" 
                                accept="image/*"
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-4 text-center">
                            {isEditMode 
                                ? "Uploading a new photo will re-index the face token." 
                                : "Original High-Res image will be sent to Face++ Neural Net. A compressed copy will be saved for UI display."}
                        </p>
                    </div>
                </div>

                {/* Right Column: Form Data */}
                <div className="lg:col-span-2">
                    <form onSubmit={handleSubmit} className="bg-eagle-800 border border-eagle-700 rounded-lg p-8">
                         <h3 className="text-sm font-bold text-slate-300 mb-6 uppercase tracking-wider flex items-center">
                            <Shield size={16} className="mr-2" /> Subject Demographics
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Simple Fields */}
                            <div className="md:col-span-2">
                                <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Full Name *</label>
                                <input 
                                    type="text" 
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                    placeholder="SURNAME Firstname"
                                />
                            </div>
                            
                            <div className="md:col-span-2">
                                <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Primary Offense / Crime *</label>
                                <input 
                                    type="text" 
                                    name="crime"
                                    value={formData.crime}
                                    onChange={handleInputChange}
                                    className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                    placeholder="e.g. Armed Robbery, Fraud"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Location / L.G.A</label>
                                <input 
                                    type="text" 
                                    name="location"
                                    value={formData.location}
                                    onChange={handleInputChange}
                                    list="city-suggestions"
                                    className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                    placeholder="e.g. Lagos, Abuja..."
                                />
                                <datalist id="city-suggestions">
                                    {Object.keys(CITY_COORDINATES).map(city => (
                                        <option key={city} value={city.charAt(0).toUpperCase() + city.slice(1)} />
                                    ))}
                                </datalist>
                                <p className="text-[10px] text-slate-500 mt-1">Coordinates will be auto-assigned if recognized.</p>
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">NIN / ID Number</label>
                                <input 
                                    type="text" 
                                    name="nin"
                                    value={formData.nin}
                                    onChange={handleInputChange}
                                    className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                    placeholder="National Identity Number"
                                />
                            </div>

                            {/* Advanced Fields */}
                            {mode === 'ADVANCED' && (
                                <>
                                    <div className="md:col-span-2 border-t border-eagle-700 my-2 pt-4">
                                        <p className="text-xs font-bold text-slate-500 mb-4 uppercase">Advanced Bio-metrics</p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Current Status</label>
                                        <select 
                                            name="status"
                                            value={formData.status}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                        >
                                            <option value="WANTED">WANTED</option>
                                            <option value="IN_CUSTODY">IN CUSTODY</option>
                                            <option value="CLEARED">CLEARED</option>
                                            <option value="DECEASED">DECEASED</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Gender</label>
                                        <select 
                                            name="gender"
                                            value={formData.gender}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                        >
                                            <option value="MALE">Male</option>
                                            <option value="FEMALE">Female</option>
                                            <option value="OTHER">Other</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Date of Birth</label>
                                        <input 
                                            type="date" 
                                            name="dob"
                                            value={formData.dob}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Physical Marks / Scars</label>
                                        <input 
                                            type="text" 
                                            name="physicalMarks"
                                            value={formData.physicalMarks}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                            placeholder="Tattoos, scars, birthmarks..."
                                        />
                                    </div>

                                    {/* Map Coordinates */}
                                    <div className="md:col-span-2 border-t border-eagle-700 my-2 pt-4">
                                        <p className="text-xs font-bold text-slate-500 mb-4 uppercase flex items-center">
                                            <MapPin size={12} className="mr-2"/> Geo-Spatial Data
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Latitude</label>
                                        <input 
                                            type="number" 
                                            step="any"
                                            name="lat"
                                            value={formData.lat}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                            placeholder="e.g. 9.0765"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Longitude</label>
                                        <input 
                                            type="number" 
                                            step="any"
                                            name="lng"
                                            value={formData.lng}
                                            onChange={handleInputChange}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                            placeholder="e.g. 7.3986"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">Officer Notes</label>
                                        <textarea 
                                            name="notes"
                                            value={formData.notes}
                                            onChange={handleInputChange}
                                            rows={3}
                                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                            placeholder="Additional intelligence..."
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Status / Progress */}
                        {isProcessing && (
                            <div className="mt-6 bg-eagle-900/50 rounded-lg p-4 border border-eagle-700 space-y-3">
                                {steps.map((step) => {
                                    let icon = <Circle size={16} className="text-slate-600" />;
                                    let textColor = "text-slate-500";
                                    let borderColor = "border-transparent";

                                    if (activeStep > step.id) {
                                        icon = <CheckCircle size={16} className="text-green-500" />;
                                        textColor = "text-green-500";
                                    } else if (activeStep === step.id) {
                                        icon = <Loader2 size={16} className="text-blue-500 animate-spin" />;
                                        textColor = "text-blue-400 font-bold";
                                        borderColor = "border-blue-500/30 bg-blue-500/10";
                                    }

                                    return (
                                        <div key={step.id} className={`flex items-center space-x-3 p-2 rounded ${borderColor}`}>
                                            {icon}
                                            <span className={`text-sm font-mono ${textColor}`}>{step.label}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {status && !isProcessing && (
                            <div className={`mt-6 p-4 rounded flex flex-col items-start border ${status.type === 'success' ? 'bg-green-900/20 border-green-900 text-green-400' : 'bg-red-900/20 border-red-900 text-red-400'}`}>
                                <div className="flex items-center">
                                    {status.type === 'success' ? <CheckCircle size={20} className="mr-2" /> : <AlertCircle size={20} className="mr-2" />}
                                    <span className="font-bold">{status.msg}</span>
                                </div>
                                {status.type === 'error' && status.msg.includes('Authentication Failed') && (
                                     <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }} className="mt-2 text-xs underline flex items-center hover:text-white">
                                        <Settings size={12} className="mr-1" /> Configure Credentials in Settings
                                     </a>
                                )}
                            </div>
                        )}

                        <div className="mt-8 pt-6 border-t border-eagle-700 flex justify-end">
                            <button 
                                type="submit"
                                disabled={isProcessing}
                                className={`px-6 py-3 rounded font-bold flex items-center space-x-2 transition-all ${isProcessing ? 'bg-slate-700 text-slate-400' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}`}
                            >
                                {isProcessing ? (
                                    <span>Processing...</span>
                                ) : (
                                    <>
                                        {isEditMode ? <Edit size={18} /> : <Save size={18} />}
                                        <span>{isEditMode ? 'Update Record' : 'Register Identity'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
