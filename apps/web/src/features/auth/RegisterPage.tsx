import {
  ACADEMIC_PROGRAMS,
  PROGRAMS,
  batchOf,
  maxSemesterOf,
  type AcademicProgram,
  type IdentityDocumentType,
  type ParkingUserCategory,
  type RegistrationRequest,
  type StudentRegistrationRequest,
} from '@cpvts/shared';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck,
  FileText,
  GraduationCap,
  IdCard,
  LoaderCircle,
  Upload,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/use-auth';
import { errorMessage } from '@/lib/error-message';

export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [params] = useSearchParams();

  const initialCategory: ParkingUserCategory =
    params.get('category') === 'staff' ? 'STAFF' : 'STUDENT';
  const [category, setCategory] = useState<ParkingUserCategory>(initialCategory);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Personal Credentials
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Institutional Identity
  const [institutionalId, setInstitutionalId] = useState('');
  const [confirmInstitutionalId, setConfirmInstitutionalId] = useState('');

  // Student Academic Details
  const currentYear = new Date().getFullYear();
  const [program, setProgram] = useState<AcademicProgram>('BCA');
  const [department, setDepartment] = useState('Computer Applications');
  const [admissionYear, setAdmissionYear] = useState<number>(currentYear);
  const [currentSemester, setCurrentSemester] = useState<number>(1);

  // Derived Batch and Max Semester
  const derivedBatch = batchOf(program, admissionYear);
  const maxSemesters = maxSemesterOf(program);

  const handleProgramChange = (newProgram: AcademicProgram) => {
    setProgram(newProgram);
    const newMax = maxSemesterOf(newProgram);
    if (currentSemester > newMax) {
      setCurrentSemester(newMax);
    }
    // Update default department if matching defaults
    if (newProgram === 'BCA') setDepartment('Computer Applications');
    else if (newProgram === 'BCOM') setDepartment('Commerce');
    else if (newProgram === 'BBA') setDepartment('Business Administration');
    else if (newProgram === 'MCA') setDepartment('Master of Computer Applications');
    else if (newProgram === 'MBA') setDepartment('Management Studies');
  };

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 validation
  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim() || !email.trim() || !phone.trim() || !password) {
      setError('Please fill in all personal information fields.');
      return;
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setStep(2);
  };

  // Step 2 validation
  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!institutionalId.trim()) {
      setError('Please enter your USN or Employee ID.');
      return;
    }
    if (institutionalId.trim().toUpperCase() !== confirmInstitutionalId.trim().toUpperCase()) {
      setError('Institutional ID confirmation does not match.');
      return;
    }

    if (category === 'STUDENT') {
      if (!department.trim() || department.trim().length < 2) {
        setError('Department name must be at least 2 characters.');
        return;
      }
      if (currentSemester < 1 || currentSemester > maxSemesters) {
        setError(`Semester must be between 1 and ${maxSemesters} for ${PROGRAMS[program].label}.`);
        return;
      }
    }

    setStep(3);
  };

  // Step 3 file handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('The identity document must be 2 MB or smaller.');
      return;
    }

    const acceptedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!acceptedTypes.includes(file.type)) {
      setError('Please upload a JPEG, PNG or PDF document.');
      return;
    }

    setError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      setFileBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  // Final submission
  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedFile || !fileBase64) {
      setError('Please upload your institutional identity document.');
      return;
    }

    setLoading(true);
    try {
      if (category === 'STUDENT') {
        const studentPayload: StudentRegistrationRequest = {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
          institutionalId: institutionalId.trim().toUpperCase(),
          confirmInstitutionalId: confirmInstitutionalId.trim().toUpperCase(),
          document: {
            fileName: selectedFile.name,
            mimeType: selectedFile.type as IdentityDocumentType,
            contentBase64: fileBase64,
          },
          academic: {
            program,
            department: department.trim(),
            admissionYear: Number(admissionYear),
            currentSemester: Number(currentSemester),
          },
        };
        await register(category, studentPayload);
      } else {
        const staffPayload: RegistrationRequest = {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
          institutionalId: institutionalId.trim().toUpperCase(),
          confirmInstitutionalId: confirmInstitutionalId.trim().toUpperCase(),
          document: {
            fileName: selectedFile.name,
            mimeType: selectedFile.type as IdentityDocumentType,
            contentBase64: fileBase64,
          },
        };
        await register(category, staffPayload);
      }
      setStep(4);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-muted/20">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-3.5" />
          Back to Login
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground text-center">
          {category === 'STUDENT' ? 'Student Registration' : 'Campus Staff Registration'}
        </h1>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Create an institutional account for seamless campus parking
        </p>

        {/* Progress indicator */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                step === s
                  ? 'w-8 bg-primary'
                  : step > s
                    ? 'w-8 bg-emerald-500'
                    : 'w-4 bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
        <Card className="shadow-lg border-border">
          <CardContent className="p-6 sm:p-8">
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* STEP 1: Personal Credentials */}
            {step === 1 && (
              <form onSubmit={handleStep1Next} className="space-y-4">
                <div className="flex items-center justify-between border-b pb-3 mb-4">
                  <span className="text-sm font-bold flex items-center gap-2">
                    <User className="size-4 text-primary" />
                    Step 1: Account Information
                  </span>
                  <div className="flex gap-1 text-xs">
                    <Button
                      type="button"
                      variant={category === 'STUDENT' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCategory('STUDENT')}
                      className="h-7 text-xs"
                    >
                      Student
                    </Button>
                    <Button
                      type="button"
                      variant={category === 'STAFF' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCategory('STAFF')}
                      className="h-7 text-xs"
                    >
                      Staff
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-name">Full Name</Label>
                  <Input
                    id="reg-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    required
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Institutional E-mail</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      category === 'STUDENT'
                        ? 'student@college.edu.in'
                        : 'staff@college.edu.in'
                    }
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Must use your official institutional email domain.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-phone">Phone Number (10–15 digits)</Label>
                  <Input
                    id="reg-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+919876543210"
                    required
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-pwd">Password (10+ chars)</Label>
                    <Input
                      id="reg-pwd"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-pwd2">Confirm Password</Label>
                    <Input
                      id="reg-pwd2"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full gap-2 mt-6">
                  Continue to Step 2
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            )}

            {/* STEP 2: Institutional Identity & Academic Profile */}
            {step === 2 && (
              <form onSubmit={handleStep2Next} className="space-y-4">
                <div className="border-b pb-3 mb-4">
                  <span className="text-sm font-bold flex items-center gap-2">
                    <IdCard className="size-4 text-primary" />
                    Step 2: Institutional & Academic Identity
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {category === 'STUDENT'
                      ? 'Enter your institutional details and academic profile for parking eligibility.'
                      : 'Enter the ID number printed on your physical college identification card.'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-inst-id">
                    {category === 'STUDENT'
                      ? 'Student USN / Roll Number'
                      : 'Employee ID / Faculty Code'}
                  </Label>
                  <Input
                    id="reg-inst-id"
                    value={institutionalId}
                    onChange={(e) => setInstitutionalId(e.target.value.toUpperCase())}
                    placeholder={category === 'STUDENT' ? '2BT22CS001' : 'EMP-1042'}
                    required
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-confirm-inst-id">Confirm Institutional ID</Label>
                  <Input
                    id="reg-confirm-inst-id"
                    value={confirmInstitutionalId}
                    onChange={(e) => setConfirmInstitutionalId(e.target.value.toUpperCase())}
                    placeholder="Re-type your ID exactly as above"
                    required
                  />
                </div>

                {category === 'STUDENT' && (
                  <div className="space-y-4 pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                      <GraduationCap className="size-4" />
                      Academic Profile
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="reg-program">Degree Program</Label>
                        <select
                          id="reg-program"
                          value={program}
                          onChange={(e) => handleProgramChange(e.target.value as AcademicProgram)}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {ACADEMIC_PROGRAMS.map((p) => (
                            <option key={p} value={p}>
                              {PROGRAMS[p].label} ({PROGRAMS[p].level} · {PROGRAMS[p].durationYears} yrs)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reg-dept">Department</Label>
                        <Input
                          id="reg-dept"
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          placeholder="e.g. Computer Applications"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="reg-adm-year">Admission Year</Label>
                        <select
                          id="reg-adm-year"
                          value={admissionYear}
                          onChange={(e) => setAdmissionYear(Number(e.target.value))}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {Array.from({ length: 6 }, (_, i) => currentYear - i).map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reg-semester">Current Semester</Label>
                        <select
                          id="reg-semester"
                          value={currentSemester}
                          onChange={(e) => setCurrentSemester(Number(e.target.value))}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {Array.from({ length: maxSemesters }, (_, i) => i + 1).map((s) => (
                            <option key={s} value={s}>
                              Sem {s} of {maxSemesters}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Derived Batch</Label>
                        <div className="h-9 flex items-center px-3 rounded-md border bg-muted/50 font-mono text-xs font-bold text-foreground">
                          {derivedBatch.label}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
                    Back
                  </Button>
                  <Button type="submit" className="flex-1 gap-2">
                    Continue to Document Upload
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 3: Identity Document Upload */}
            {step === 3 && (
              <form onSubmit={handleFinalSubmit} className="space-y-4">
                <div className="border-b pb-3 mb-4">
                  <span className="text-sm font-bold flex items-center gap-2">
                    <FileCheck className="size-4 text-primary" />
                    Step 3: Document Verification Upload
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload an image or PDF of your student ID card or employee badge.
                  </p>
                </div>

                <div className="rounded-xl border-2 border-dashed p-6 text-center space-y-3">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
                    <Upload className="size-6" />
                  </div>
                  <div>
                    <Label htmlFor="reg-doc" className="cursor-pointer font-bold text-primary hover:underline">
                      Choose document to upload
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPEG, PNG or PDF · Up to 2 MB
                    </p>
                  </div>
                  <Input
                    id="reg-doc"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {selectedFile && (
                  <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-primary" />
                      <span className="font-semibold">{selectedFile.name}</span>
                    </div>
                    <span className="text-muted-foreground font-mono">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => setStep(2)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading || !selectedFile}
                    className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {loading ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    Complete Registration
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 4: Submission Confirmation & Landing */}
            {step === 4 && (
              <div className="text-center space-y-5 py-4">
                <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 mx-auto">
                  <CheckCircle2 className="size-10" />
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">Registration Submitted</h2>
                  <p className="text-sm text-muted-foreground">
                    Your account has been created and signed in!
                  </p>
                </div>

                <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300 text-left text-xs">
                  <Clock className="size-4 text-amber-600" />
                  <AlertDescription>
                    Your verification document is now <strong>PENDING</strong> administrator review.
                    You can register your vehicles immediately in the portal. Parking allocation will
                    activate once approved.
                  </AlertDescription>
                </Alert>

                <Button size="lg" asChild className="w-full gap-2">
                  <Link to="/portal">
                    Enter Parking Portal
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
