import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function resetPassword() {
  const newPassword = 'Test1234!'; // Nueva contraseña
  
  try {
    // Hashear la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Actualizar el usuario
    const updatedUser = await prisma.user.update({
      where: {
        email: 'test@trailguard.app'
      },
      data: {
        password: hashedPassword
      }
    });
    
    console.log('✅ Contraseña actualizada exitosamente para:', updatedUser.email);
    console.log('📧 Email: test@trailguard.app');
    console.log('🔑 Nueva contraseña: Test1234!');
  } catch (error) {
    console.error('Error al actualizar la contraseña:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetPassword();